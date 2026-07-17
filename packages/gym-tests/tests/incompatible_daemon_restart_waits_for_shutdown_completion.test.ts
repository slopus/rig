import { afterEach, describe, expect, it } from "vitest";

import { createGym, waitForFile, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("restarting an incompatible daemon", () => {
    it("waits for the old daemon to finish cleanup before starting its replacement", async () => {
        const gym = await createGym({
            entrypoint: ["sh", "/workspace/restart-incompatible-daemon.sh"],
            environment: {
                RIG_SERVER_DIRECTORY: "/home/rig/.local/state/rig-r013",
            },
            files: {
                "restart-incompatible-daemon.sh": restartIncompatibleDaemonScript,
            },
            inference(request, callIndex) {
                expect(callIndex).toBe(0);
                expect(request.context.messages.at(-1)).toMatchObject({ role: "user" });
                return {
                    content: [
                        {
                            arguments: {
                                cmd: holdDaemonShutdownCommand,
                                yield_time_ms: 30_000,
                            },
                            id: "hold-daemon-shutdown",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                };
            },
            startupText: "Restart local daemon?",
            timeoutMs: 30_000,
        });
        running.add(gym);

        const prompt = await gym.terminal.snapshot();
        expect(prompt.text).toContain("development code changed");
        gym.terminal.press("enter");

        await waitForFile(gym, "/workspace/daemon-shutdown-signal-received");
        const replacementBeforeRelease = await observeReplacementDaemon(gym);
        expect(replacementBeforeRelease.stdout).toContain("original daemon still registered");

        await gym.runInContainer("touch", ["/workspace/release-daemon-shutdown"]);
        await waitForFile(gym, "/workspace/daemon-shutdown-hold-released");
        await waitForReplacementDaemon(gym);
        await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("Ask Rig to do anything"),
            "the replacement daemon composer after cleanup finished",
            30_000,
        );
    }, 90_000);
});

async function observeReplacementDaemon(gym: Gym): Promise<{ stdout: string }> {
    return gym.runInContainer("node", [
        "-e",
        `const fs=require("node:fs");
const registryPath=process.env.RIG_SERVER_DIRECTORY + "/server.json";
const original=Number(fs.readFileSync("/workspace/original-daemon-pid", "utf8"));
const deadline=Date.now()+1000;
const check=()=>{
    const current=JSON.parse(fs.readFileSync(registryPath, "utf8")).pid;
    if(current!==original){console.log("replacement daemon registered");return;}
    if(Date.now()>=deadline){console.log("original daemon still registered");return;}
    setTimeout(check,50);
};
check();`,
    ]);
}

async function waitForReplacementDaemon(gym: Gym): Promise<void> {
    await gym.runInContainer(
        "sh",
        [
            "-c",
            `original=$(cat /workspace/original-daemon-pid)
while [ "$(node -e 'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.env.RIG_SERVER_DIRECTORY + "/server.json", "utf8")).pid)')" = "$original" ]; do sleep 0.05; done`,
        ],
        { timeoutMs: 30_000 },
    );
}

const holdDaemonShutdownCommand =
    "trap 'touch /workspace/daemon-shutdown-signal-received; while [ ! -e /workspace/release-daemon-shutdown ]; do sleep 0.05; done; touch /workspace/daemon-shutdown-hold-released; exit 0' TERM INT; touch /workspace/daemon-shutdown-hold-ready; while :; do sleep 1; done";

const restartIncompatibleDaemonScript = `#!/bin/sh
set -eu
RIG_DEVELOPMENT_BUILD_ID=older-source node /app/packages/rig/dist/main.js exec --permission-mode full_access "Start the daemon shutdown hold." > /workspace/old-client.log 2>&1 &
while [ ! -e /workspace/daemon-shutdown-hold-ready ]; do sleep 0.05; done
node -e 'const fs=require("node:fs"); const registry=JSON.parse(fs.readFileSync(process.env.RIG_SERVER_DIRECTORY + "/server.json", "utf8")); fs.writeFileSync("/workspace/original-daemon-pid", String(registry.pid));'
RIG_DEVELOPMENT_BUILD_ID=current-source exec node /app/packages/rig/dist/main.js
`;
