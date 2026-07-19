import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("durable integration skills", () => {
    it("requests SKILL.md contents and continues the original run after restart", async () => {
        const gym = await createGym({
            entrypoint: ["sh", "/workspace/keep-gym-container-running.sh"],
            mode: "docker",
            files: {
                "durable-skill-client.mjs": durableSkillClient,
                "keep-gym-container-running.sh": keepGymContainerRunning,
            },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    expect(request.context.systemPrompt).toContain(
                        "EXACT_INTEGRATION_SYSTEM_PROMPT",
                    );
                    expect(request.context.systemPrompt).toContain("release-check");
                    expect(request.context.systemPrompt).toContain("durable");
                    expect(
                        request.context.tools?.find((tool) => tool.name === "read_skill"),
                    ).toMatchObject({
                        parameters: { required: ["name"], type: "object" },
                    });
                    return {
                        content: [
                            {
                                arguments: { name: "release-check" },
                                id: "durable-skill-provider-call",
                                name: "read_skill",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(1);
                expect(request.context.messages.at(-1)).toMatchObject({
                    content: [
                        {
                            text: expect.stringContaining("DURABLE_SKILL_BODY_SENTINEL"),
                            type: "text",
                        },
                    ],
                    isError: false,
                    role: "toolResult",
                    toolName: "read_skill",
                });
                return {
                    content: [{ text: "DURABLE_SKILL_COMPLETED", type: "text" }],
                };
            },
        });
        running.add(gym);

        const submitted = await gym.runInContainer("node", [
            "/workspace/durable-skill-client.mjs",
            "submit",
        ]);
        expect(submitted.stderr).toBe("");
        const submission = JSON.parse(submitted.stdout) as { runId: string; sessionId: string };

        const pending = await gym.runInContainer("node", [
            "/workspace/durable-skill-client.mjs",
            "pending",
        ]);
        expect(pending.stderr).toBe("");
        expect(JSON.parse(pending.stdout)).toMatchObject({
            arguments: { name: "release-check" },
            runId: submission.runId,
            sessionId: submission.sessionId,
            skill: {
                description: "Check a release using integration-owned instructions.",
                location: "durable",
                name: "release-check",
            },
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
            'node /workspace/durable-skill-client.mjs "$1" "$2" "$3" 2>&1; code=$?; echo EXIT:$code',
            "durable-skill-client",
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

const durableSkillClient = String.raw`
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
    throw new Error("Timed out waiting for a durable skill request.");
}

if (action === "submit") {
    const sessions = await requestJson("GET", "/sessions");
    const session = sessions.sessions[0];
    if (session === undefined) throw new Error("No primary session found.");
    const submitted = await requestJson(
        "POST",
        "/sessions/" + encodeURIComponent(session.id) + "/messages",
        {
            text: "Use the release-check skill.",
            systemPrompt: "EXACT_INTEGRATION_SYSTEM_PROMPT",
            skills: [{
                name: "release-check",
                description: "Check a release using integration-owned instructions.",
                location: "durable",
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
        {
            status: "completed",
            output: [
                "---",
                "name: release-check",
                "description: Check a release using integration-owned instructions.",
                "---",
                "DURABLE_SKILL_BODY_SENTINEL",
                "Follow the integration release checklist.",
            ].join("\\n"),
        },
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
