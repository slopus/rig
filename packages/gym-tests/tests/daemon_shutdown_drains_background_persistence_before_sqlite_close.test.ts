import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createGym, waitForFile, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const execFileAsync = promisify(execFile);

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("daemon shutdown persistence drain", () => {
    it("waits for held background cleanup before closing SQLite and restarts cleanly", async () => {
        await resetProofFiles();
        const backgroundCommand = "bash /workspace/held-background-persistence.sh";
        const gym = await createGym({
            cols: 92,
            entrypoint: ["bash", "/workspace/shutdown-drain-entrypoint.sh"],
            environment: {
                RIG_SERVER_DIRECTORY: "/home/rig/.local/state/rig",
            },
            files: {
                "held-background-persistence.sh": heldBackgroundPersistenceScript,
                "shutdown-drain-entrypoint.sh": shutdownDrainEntrypointScript,
            },
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: backgroundCommand, yield_time_ms: 250 },
                                id: "hold-background-persistence",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return {
                        content: [
                            {
                                text: "The persistence hold is active in the background.",
                                type: "text",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(2);
                expect(lastMessage).toMatchObject({ role: "user" });
                const contextText = request.context.messages
                    .map((message) => messageText(message.content))
                    .join("\n");
                expect(contextText).toContain("Start the held background persistence check.");
                expect(contextText).toContain("The persistence hold is active in the background.");
                return {
                    content: [
                        {
                            text: "The restarted daemon loaded the session and is healthy.",
                            type: "text",
                        },
                    ],
                };
            },
            rows: 26,
        });
        running.add(gym);

        submit(gym, "Start the held background persistence check.");
        await waitForFile(gym, "/workspace/background-persistence-ready");
        const held = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("The persistence hold is active") &&
                snapshot.text.includes("1 background terminal running") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the held background continuation",
            30_000,
        );
        await captureProof(gym, "01-background-held.png");
        expect(held.text).not.toContain("database is not open");

        gym.terminal.press("ctrlD");
        await waitForFile(gym, "/workspace/client-exited");
        await gym.runInContainer("sh", [
            "-c",
            'node -e \'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync("/home/rig/.local/state/rig/server.json","utf8")); fs.writeFileSync("/workspace/original-daemon-pid",String(value.pid))\'',
        ]);

        const stopped = await gym.runInContainer("node", [
            "/app/packages/rig/dist/main.js",
            "daemon",
            "stop",
        ]);
        expect(stopped.stdout).toContain("Daemon is stopping.");
        await gym.runInContainer(
            "sh",
            [
                "-c",
                'while [ ! -e /workspace/shutdown-signal-received ]; do sleep 0.05; done; kill -0 "$(cat /workspace/original-daemon-pid)"; touch /workspace/release-background-persistence',
            ],
            { timeoutMs: 30_000 },
        );
        await waitForFile(gym, "/workspace/background-persistence-released");
        await gym.runInContainer(
            "sh",
            [
                "-c",
                "while node /app/packages/rig/dist/main.js daemon status | grep -q 'Daemon is running'; do sleep 0.05; done",
            ],
            { timeoutMs: 30_000 },
        );
        await gym.runInContainer(
            "sh",
            [
                "-c",
                'pid=$(cat /workspace/original-daemon-pid); while kill -0 "$pid" 2>/dev/null; do state=$(awk "{print \\$3}" "/proc/$pid/stat" 2>/dev/null || true); [ "$state" = Z ] && break; sleep 0.05; done',
            ],
            { timeoutMs: 30_000 },
        );

        const daemonLog = await gym.runInContainer("sh", [
            "-c",
            "test ! -f /home/rig/.local/state/rig/server.log || cat /home/rig/.local/state/rig/server.log",
        ]);
        await writeProof("02-daemon.log", daemonLog.stdout + daemonLog.stderr);
        expect(daemonLog.stdout).not.toContain("database is not open");
        expect(daemonLog.stderr).not.toContain("database is not open");

        await gym.runInContainer("touch", ["/workspace/restart-client"]);
        const restarting = await gym.terminal.waitForText("RESTARTING_RIG_CLIENT", 30_000);
        await gym.terminal.waitUntil(
            (snapshot) => {
                const liveRows = snapshot.rows.slice(-6).join("\n");
                return (
                    snapshot.outputRevision > restarting.outputRevision &&
                    liveRows.includes("Ask Rig to do anything") &&
                    liveRows.includes("gym off · /workspace")
                );
            },
            "the restarted client composer",
            30_000,
        );
        submit(gym, "Confirm the restarted daemon is healthy.");
        const restarted = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("The restarted daemon loaded the session and is healthy.") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "a healthy turn after daemon restart",
            30_000,
        );
        expect(restarted.text).not.toContain("database is not open");
        await captureProof(gym, "03-healthy-restart.png");

        await gym.runInContainer("node", ["/app/packages/rig/dist/main.js", "daemon", "stop"]);
        gym.terminal.press("ctrlD");
        await gym.terminal.waitForText("FINAL_DAEMON_RESTARTED", 30_000);

        const daemonStatus = await gym.runInContainer("node", [
            "/app/packages/rig/dist/main.js",
            "daemon",
            "status",
        ]);
        const sqliteState = await gym.runInContainer("node", [
            "-e",
            'const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync("/home/rig/.local/state/rig/sessions.sqlite"); const session=db.prepare("SELECT status, active_run_id FROM sessions WHERE parent_session_id IS NULL ORDER BY updated_at_ms DESC LIMIT 1").get(); const rows=db.prepare("SELECT data_json FROM session_events WHERE type = ? ORDER BY seq").all("agent_event"); const backgroundCleanupPersisted=rows.some(({data_json})=>{const event=JSON.parse(data_json).event; return event?.type === "background_processes_changed" && event.running === 0;}); console.log(JSON.stringify({backgroundCleanupPersisted,session})); db.close()',
        ]);
        expect(daemonStatus.stdout).toContain("Daemon is running");
        expect(sqliteState.stdout).toContain('"active_run_id":null');
        expect(sqliteState.stdout).toContain('"backgroundCleanupPersisted":true');
        await writeProof(
            "04-restart.txt",
            daemonStatus.stdout + daemonStatus.stderr + sqliteState.stdout + sqliteState.stderr,
        );
        await writeRunProof();
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

async function captureProof(gym: Gym, fileName: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await mkdir(directory, { recursive: true });
    await gym.terminal.screenshot(resolve(directory, fileName));
}

async function writeProof(fileName: string, content: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, fileName), content, "utf8");
}

async function resetProofFiles(): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await mkdir(directory, { recursive: true });
    await Promise.all(
        [
            "01-background-held.png",
            "02-daemon.log",
            "03-healthy-restart.png",
            "04-restart.txt",
            "05-run.txt",
        ].map((fileName) => rm(resolve(directory, fileName), { force: true })),
    );
}

async function writeRunProof(): Promise<void> {
    const image = process.env.RIG_GYM_IMAGE ?? "rig-gym:local";
    const { stdout } = await execFileAsync("docker", [
        "image",
        "inspect",
        image,
        "--format",
        "{{.Id}}",
    ]);
    await writeProof(
        "05-run.txt",
        [
            `Completed: ${new Date().toISOString()}`,
            `Image: ${image}`,
            `Image ID: ${stdout.trim()}`,
        ].join("\n") + "\n",
    );
}

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter(
            (block): block is { text: string } =>
                typeof block === "object" &&
                block !== null &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("\n");
}

const heldBackgroundPersistenceScript = `#!/bin/sh
trap 'touch /workspace/shutdown-signal-received; while [ ! -e /workspace/release-background-persistence ]; do sleep 0.05; done; touch /workspace/background-persistence-released; exit 0' TERM INT
touch /workspace/background-persistence-ready
while [ ! -e /workspace/release-background-persistence ]; do sleep 0.05; done
touch /workspace/background-persistence-released
`;

const shutdownDrainEntrypointScript = `#!/bin/sh
set -eu
node /app/packages/rig/dist/main.js
touch /workspace/client-exited
while [ ! -e /workspace/restart-client ]; do sleep 0.05; done
node /app/packages/rig/dist/main.js daemon start
printf 'RESTARTING_RIG_CLIENT\n'
node /app/packages/rig/dist/main.js resume --last || true
node /app/packages/rig/dist/main.js daemon start
printf 'FINAL_DAEMON_RESTARTED\n'
while :; do sleep 1; done
`;
