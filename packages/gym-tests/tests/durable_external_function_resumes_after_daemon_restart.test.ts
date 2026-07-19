import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("durable external integration functions", () => {
    it("continues the original run after the daemon restarts and receives its callback", async () => {
        const gym = await createGym({
            mode: "docker",
            entrypoint: ["sh", "/workspace/keep-gym-container-running.sh"],
            files: {
                "external-function-client.mjs": externalFunctionClient,
                "keep-gym-container-running.sh": keepGymContainerRunning,
            },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    expect(request.context.systemPrompt).toBe("EXACT_INTEGRATION_SYSTEM_PROMPT");
                    expect(
                        request.context.tools?.find((tool) => tool.name === "lookup_ticket"),
                    ).toMatchObject({
                        description: "Look up a ticket outside Rig.",
                        parameters: { required: ["ticket"], type: "object" },
                    });
                    return {
                        content: [
                            {
                                arguments: { ticket: 42 },
                                id: "durable-provider-call",
                                name: "lookup_ticket",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(1);
                expect(request.context.messages.at(-1)).toMatchObject({
                    content: [{ text: '{"state":"resolved"}', type: "text" }],
                    isError: false,
                    role: "toolResult",
                    toolName: "lookup_ticket",
                });
                return {
                    content: [{ text: "DURABLE_EXTERNAL_COMPLETED", type: "text" }],
                };
            },
        });
        running.add(gym);

        const submitted = await gym.runInContainer("node", [
            "/workspace/external-function-client.mjs",
            "submit",
        ]);
        expect(submitted.stderr).toBe("");
        const submission = JSON.parse(submitted.stdout) as { runId: string; sessionId: string };

        const pending = await gym.runInContainer("node", [
            "/workspace/external-function-client.mjs",
            "pending",
        ]);
        expect(pending.stderr).toBe("");
        expect(JSON.parse(pending.stdout)).toMatchObject({
            arguments: { ticket: 42 },
            runId: submission.runId,
            sessionId: submission.sessionId,
            status: "pending",
        });

        await gym.runInContainer("node", ["/app/packages/rig/dist/main.js", "daemon", "stop"]);
        await gym.runInContainer(
            "sh",
            [
                "-c",
                "while node /app/packages/rig/dist/main.js daemon status | grep -q 'Daemon is running'; do sleep 0.05; done",
            ],
            { timeoutMs: 30_000 },
        );
        const restarted = await gym.runInContainer("sh", [
            "-c",
            "node /app/packages/rig/dist/main.js daemon start 2>&1; code=$?; echo EXIT:$code",
        ]);
        expect(restarted.stdout).toContain("EXIT:0");

        const resolved = await gym.runInContainer("sh", [
            "-c",
            'node /workspace/external-function-client.mjs "$1" "$2" "$3" 2>&1; code=$?; echo EXIT:$code',
            "external-client",
            "resolve",
            submission.sessionId,
            submission.runId,
        ]);
        expect(resolved.stderr).toBe("");
        expect(resolved.stdout).toContain("EXIT:0");
        expect(
            JSON.parse(resolved.stdout.slice(0, resolved.stdout.indexOf("EXIT:0"))),
        ).toMatchObject({
            accepted: true,
            finished: true,
            runId: submission.runId,
        });
    }, 120_000);
});

const externalFunctionClient = String.raw`
import { readFile } from "node:fs/promises";
import { request } from "node:http";

const action = process.argv[2];
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
        outgoing.once("error", reject);
        if (payload !== undefined) outgoing.write(payload);
        outgoing.end();
    });
}

async function pendingCall() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const response = await requestJson("GET", "/external-tool-calls");
        if (response.calls[0] !== undefined) return response.calls[0];
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Timed out waiting for a durable external function call.");
}

if (action === "submit") {
    const sessions = await requestJson("GET", "/sessions");
    const session = sessions.sessions[0];
    if (session === undefined) throw new Error("No primary session found.");
    const submitted = await requestJson(
        "POST",
        "/sessions/" + encodeURIComponent(session.id) + "/messages",
        {
            text: "Resolve ticket 42.",
            systemPrompt: "EXACT_INTEGRATION_SYSTEM_PROMPT",
            externalTools: [{
                name: "lookup_ticket",
                description: "Look up a ticket outside Rig.",
                parameters: {
                    type: "object",
                    properties: { ticket: { type: "number" } },
                    required: ["ticket"],
                    additionalProperties: false,
                },
            }],
        },
    );
    process.stdout.write(JSON.stringify(submitted));
} else if (action === "pending") {
    process.stdout.write(JSON.stringify(await pendingCall()));
} else if (action === "resolve") {
    const sessionId = process.argv[3];
    const runId = process.argv[4];
    const call = await pendingCall();
    const resolution = await requestJson(
        "POST",
        "/sessions/" + encodeURIComponent(sessionId) +
            "/external-tool-calls/" + encodeURIComponent(call.id),
        { status: "completed", output: { state: "resolved" } },
    );
    let finished = false;
    for (let attempt = 0; attempt < 400; attempt += 1) {
        const response = await requestJson(
            "GET",
            "/sessions/" + encodeURIComponent(sessionId) + "/events",
        );
        finished = response.events.some(
            (event) => event.type === "run_finished" && event.data.runId === runId,
        );
        if (finished) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    process.stdout.write(JSON.stringify({ ...resolution, finished, runId }));
} else {
    throw new Error("Unknown action.");
}
`;

const keepGymContainerRunning = String.raw`#!/bin/sh
node /app/packages/rig/dist/main.js || true
while :; do sleep 1; done
`;
