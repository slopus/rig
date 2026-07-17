import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("messages sent during active inference", () => {
    it("keeps local and external steering between active work and the composer until consumed", async () => {
        const releaseInference = deferred<void>();
        const gym = await createGym({
            cols: 100,
            files: { "steer-from-another-client.mjs": steerFromAnotherClientScript },
            async inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: "sleep 60", yield_time_ms: 100 },
                                id: "start-background-terminal",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    return { content: [{ text: "BACKGROUND_TERMINAL_READY", type: "text" }] };
                }
                if (callIndex === 2) {
                    await releaseInference.promise;
                    return {
                        content: [
                            {
                                arguments: { cmd: "printf 'STEERING_TOOL_RAN\\n'" },
                                id: "steering-boundary-tool",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(3);
                const userText = request.context.messages
                    .filter((message) => message.role === "user")
                    .map((message) => JSON.stringify(message.content))
                    .join("\n");
                expect(userText).toContain("Explain the local result too.");
                expect(userText).toContain("Include the other client's concern.");
                return { content: [{ text: "STEERING_MESSAGES_CONSUMED", type: "text" }] };
            },
            rows: 32,
        });
        running.add(gym);

        submit(gym, "Start a background terminal.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("BACKGROUND_TERMINAL_READY") &&
                snapshot.text.includes("1 background terminal running"),
            "the persistent active-work row",
            30_000,
        );

        submit(gym, "Run a tool after I send follow-up instructions.");
        await gym.terminal.waitForText("esc to interrupt", 30_000);

        submit(gym, "Explain the local result too.");
        const external = await gym.runInContainer("node", [
            "/workspace/steer-from-another-client.mjs",
            "Include the other client's concern.",
        ]);
        expect(external.stderr).toBe("");
        expect(external.stdout.trim()).toBe("steered");

        const pending = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Messages to be submitted after next tool call") &&
                snapshot.text.includes("└ Explain the local result too.") &&
                snapshot.text.includes("Include the other client's concern.") &&
                snapshot.text.includes("1 background terminal running") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.text.includes("esc to interrupt"),
            "pending steering from the TUI and another daemon client",
            10_000,
        );
        const statusRow = rowContaining(pending.rows, "esc to interrupt");
        const activeWorkRow = rowContaining(pending.rows, "1 background terminal running");
        const pendingHeaderRow = rowContaining(
            pending.rows,
            "Messages to be submitted after next tool call",
        );
        const localSteerRow = rowContaining(pending.rows, "└ Explain the local result too.");
        const externalSteerRow = rowContaining(pending.rows, "Include the other client's concern.");
        const composerRow = rowContaining(pending.rows, "Ask Rig to do anything");
        const footerRow = rowContaining(pending.rows, "gym off · /workspace");
        expect([
            statusRow,
            activeWorkRow,
            pendingHeaderRow,
            localSteerRow,
            externalSteerRow,
            composerRow,
            footerRow,
        ]).toEqual(
            [
                ...new Set([
                    statusRow,
                    activeWorkRow,
                    pendingHeaderRow,
                    localSteerRow,
                    externalSteerRow,
                    composerRow,
                    footerRow,
                ]),
            ].sort((left, right) => left - right),
        );
        expect(
            pending.rows.filter((row) => row.trim() === "› Explain the local result too."),
        ).toEqual([]);
        expect(
            pending.rows.filter((row) => row.trim() === "› Include the other client's concern."),
        ).toEqual([]);
        const pendingRows = pending.rows.slice(pendingHeaderRow, composerRow);
        expect(pendingRows.filter((row) => row.includes("└"))).toHaveLength(1);
        expect(pendingRows.join("\n")).not.toMatch(/[│├↳]/u);

        const screenshotDirectory = process.env.RIG_GYM_SCREENSHOT_DIR;
        if (screenshotDirectory !== undefined) {
            await gym.terminal.screenshot(
                resolve(screenshotDirectory, "pending-steering-before-consumption.png"),
            );
        }

        releaseInference.resolve();
        const consumed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("STEERING_MESSAGES_CONSUMED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace"),
            "the consumed steering messages and completed response",
            30_000,
        );
        expect(consumed.text).not.toContain("Messages to be submitted after next tool call");
        expect(
            consumed.rows.filter((row) => row.trim() === "› Explain the local result too."),
        ).toHaveLength(1);
        expect(
            consumed.rows.filter((row) => row.trim() === "› Include the other client's concern."),
        ).toHaveLength(1);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function rowContaining(rows: readonly string[], text: string): number {
    const row = rows.findIndex((candidate) => candidate.includes(text));
    expect(row).toBeGreaterThanOrEqual(0);
    return row;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolvePromiseValue) => {
        resolvePromise = resolvePromiseValue;
    });
    return {
        promise,
        resolve: (value) => resolvePromise(value as T),
    };
}

const steerFromAnotherClientScript = String.raw`
import { readFile } from "node:fs/promises";
import { request } from "node:http";

const directory = "/tmp/rig-" + process.getuid();
const socketPath = directory + "/server.sock";
const token = (await readFile(directory + "/token", "utf8")).trim();

function requestJson(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const outgoing = request({
            socketPath,
            path,
            method,
            headers: {
                authorization: "Bearer " + token,
                accept: "application/json",
                ...(payload === undefined ? {} : {
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(payload),
                }),
            },
        }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            response.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                if ((response.statusCode ?? 500) >= 400) {
                    reject(new Error(text));
                    return;
                }
                resolve(text.length === 0 ? {} : JSON.parse(text));
            });
        });
        outgoing.on("error", reject);
        if (payload !== undefined) outgoing.write(payload);
        outgoing.end();
    });
}

const sessions = await requestJson("GET", "/sessions");
const active = sessions.sessions.find((session) => session.status === "running");
if (active === undefined) throw new Error("No running session found.");
await requestJson(
    "POST",
    "/sessions/" + encodeURIComponent(active.id) + "/steer",
    { text: process.argv[2] },
);
process.stdout.write("steered\n");
`;
