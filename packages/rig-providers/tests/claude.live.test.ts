import { createServer } from "node:http";
import { Type, type TSchema } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { ClaudeAuthTokenCredential } from "@/vendors/claude/ClaudeAuthTokenCredential.js";
import { ClaudeSession } from "@/vendors/claude/ClaudeSession.js";
import { renderClaudeSystemPrompt } from "@/vendors/claude/impl/renderClaudeSystemPrompt.js";
import { claude_opus_4_8_system_prompt } from "@/vendors/claude/prompts/claude_opus_4_8_system_prompt.js";
import type { SessionTool } from "@/core/SessionTool.js";
import { collectSessionEvents, textFromSessionEvents } from "./helpers/collectSessionEvents.js";

const live = process.env.RIG_LIVE_TEST === "1" && process.env.ANTHROPIC_AUTH_TOKEN;
const liveTools: readonly SessionTool[] = [
    {
        type: "local",
        name: "Read",
        description: "Read one file during the live provider check.",
        parameters: Type.Object(
            { file_path: Type.String({ description: "Absolute file path." }) },
            { additionalProperties: false },
        ),
    },
];

describe.skipIf(!live)("Claude live session", () => {
    it(
        "sends the complete supplied system prompt and tool schemas over the wire",
        { timeout: 120_000 },
        async () => {
            let capturedRequest:
                | {
                      system: { text: string }[];
                      tools: { name: string; description: string; input_schema: TSchema }[];
                  }
                | undefined;
            const server = createServer(async (request, response) => {
                const chunks: Buffer[] = [];
                for await (const chunk of request) chunks.push(Buffer.from(chunk));
                const requestBody = Buffer.concat(chunks);
                if (requestBody.length > 0 && request.url?.startsWith("/v1/messages")) {
                    capturedRequest = JSON.parse(requestBody.toString("utf8"));
                }
                const headers = new Headers();
                for (const [name, value] of Object.entries(request.headers)) {
                    if (
                        value === undefined ||
                        ["connection", "content-length", "host"].includes(name)
                    ) {
                        continue;
                    }
                    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
                }
                const upstream = await fetch(`https://api.anthropic.com${request.url}`, {
                    method: request.method ?? "POST",
                    headers,
                    ...(requestBody.length === 0 ? {} : { body: requestBody }),
                });
                const responseBody = Buffer.from(await upstream.arrayBuffer());
                response.writeHead(
                    upstream.status,
                    Object.fromEntries(
                        [...upstream.headers].filter(
                            ([name]) =>
                                ![
                                    "content-encoding",
                                    "content-length",
                                    "transfer-encoding",
                                ].includes(name),
                        ),
                    ),
                );
                response.end(responseBody);
            });
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(0, "127.0.0.1", resolve);
            });
            const address = server.address();
            if (address === null || typeof address === "string") {
                throw new Error("Missing Claude capture port.");
            }
            const credential = await ClaudeAuthTokenCredential.tryLoad({ env: process.env });
            if (credential === null) throw new Error("Missing ANTHROPIC_AUTH_TOKEN.");
            const session = new ClaudeSession("wire-golden", {
                context: {
                    instructions: "Wire-specific instructions.",
                    messages: [],
                },
                credential,
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
                },
                model: "opus[1m]",
                tools: liveTools,
            });
            try {
                await collectSessionEvents(
                    session.run({
                        context: {
                            messages: [{ role: "user", content: "Reply exactly WIRE_OK." }],
                        },
                    }),
                );
            } finally {
                session.destroy();
                await new Promise<void>((resolve) => server.close(() => resolve()));
            }
            expect(capturedRequest?.system.at(-1)?.text).toBe(
                `${renderClaudeSystemPrompt(claude_opus_4_8_system_prompt, {
                    cwd: process.cwd(),
                    env: process.env,
                })}\n\nWire-specific instructions.`,
            );
            expect(capturedRequest?.tools.map(({ name }) => name).sort()).toEqual(
                liveTools.map(({ name }) => name).sort(),
            );
            expect(capturedRequest?.tools.every(({ description }) => description.length > 0)).toBe(
                true,
            );
            expect(
                capturedRequest?.tools
                    .map(({ name, input_schema }) => ({
                        name,
                        input_schema: normalizeJsonSchema(input_schema),
                    }))
                    .sort((left, right) => left.name.localeCompare(right.name)),
            ).toEqual(
                liveTools
                    .map(({ name, parameters }) => ({
                        name,
                        input_schema: normalizeJsonSchema(parameters),
                    }))
                    .sort((left, right) => left.name.localeCompare(right.name)),
            );
        },
    );

    it(
        "runs stripped SDK turns, switches models, and compacts reconstructed context",
        { timeout: 120_000 },
        async () => {
            const credential = await ClaudeAuthTokenCredential.tryLoad({
                env: process.env,
            });
            if (credential === null) throw new Error("Missing ANTHROPIC_AUTH_TOKEN.");
            const session = new ClaudeSession("rig-providers-claude-live", {
                context: {
                    instructions:
                        "You are testing Rig's Claude provider. Follow exact reply instructions.",
                    messages: [],
                },
                credential,
                cwd: process.cwd(),
                model: "opus[1m]",
                skills: [
                    {
                        name: "live-marker",
                        description: "The exact marker for this session is RIG_CLAUDE_SKILL.",
                        source: "file",
                        location: "/virtual/live-marker/SKILL.md",
                    },
                ],
            });
            try {
                const first = await collectSessionEvents(
                    session.run({
                        context: {
                            messages: [
                                {
                                    role: "user",
                                    content:
                                        "Reply with exactly FIRST RIG_CLAUDE_SKILL and nothing else.",
                                },
                            ],
                        },
                    }),
                );
                expect(textFromSessionEvents(first).trim()).toBe("FIRST RIG_CLAUDE_SKILL");

                const switched = await collectSessionEvents(
                    session.run({
                        model: "sonnet[1m]",
                        context: {
                            messages: [
                                {
                                    role: "user",
                                    content:
                                        "Reply with exactly FIRST RIG_CLAUDE_SKILL and nothing else.",
                                },
                                {
                                    role: "assistant",
                                    content: "FIRST RIG_CLAUDE_SKILL",
                                },
                                {
                                    role: "user",
                                    content:
                                        "Remember the exact marker RIG_CLAUDE_SKILL. Reply with exactly SWITCHED and nothing else.",
                                },
                            ],
                        },
                    }),
                );
                expect(textFromSessionEvents(switched).trim()).toBe("SWITCHED");

                const compacted = await session.compact({
                    instructions: "Preserve the exact markers RIG_CLAUDE_SKILL and SWITCHED.",
                });
                expect(compacted.status).toBe("completed");
                if (compacted.status === "completed") {
                    expect(compacted.summary).toContain("RIG_CLAUDE_SKILL");
                    expect(compacted.summary).toContain("SWITCHED");
                    const continued = await collectSessionEvents(
                        session.run({
                            context: {
                                messages: [
                                    ...compacted.context.messages,
                                    {
                                        role: "user",
                                        content:
                                            "Using only the compacted context, reply exactly POST_COMPACT RIG_CLAUDE_SKILL SWITCHED and nothing else.",
                                    },
                                ],
                            },
                        }),
                    );
                    expect(textFromSessionEvents(continued).trim()).toBe(
                        "POST_COMPACT RIG_CLAUDE_SKILL SWITCHED",
                    );
                }
            } finally {
                session.destroy();
            }
        },
    );

    it("runs native compaction without custom instructions", { timeout: 120_000 }, async () => {
        const credential = await ClaudeAuthTokenCredential.tryLoad({ env: process.env });
        if (credential === null) throw new Error("Missing ANTHROPIC_AUTH_TOKEN.");
        const session = new ClaudeSession("rig-providers-claude-plain-compact-live", {
            context: {
                instructions: "Preserve conversation facts accurately.",
                messages: [
                    { role: "user", content: "Remember the exact marker PLAIN_COMPACT_MARKER." },
                    { role: "assistant", content: "I will remember PLAIN_COMPACT_MARKER." },
                    { role: "user", content: "The current task is native compaction testing." },
                    { role: "assistant", content: "Understood." },
                ],
            },
            credential,
            cwd: process.cwd(),
            model: "sonnet[1m]",
        });
        try {
            const compacted = await session.compact();
            expect(compacted.status).toBe("completed");
            if (compacted.status === "completed") {
                expect(compacted.summary).toContain("PLAIN_COMPACT_MARKER");
            }
        } finally {
            session.destroy();
        }
    });
});

function normalizeJsonSchema(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeJsonSchema);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => key !== "$schema")
                .map(([key, child]) => [key, normalizeJsonSchema(child)]),
        );
    }
    return value;
}
