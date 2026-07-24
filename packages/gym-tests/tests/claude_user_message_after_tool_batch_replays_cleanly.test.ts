import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const servers = new Set<Server>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
    for (const server of servers) server.closeAllConnections();
    await Promise.all(
        [...servers].map(
            (server) =>
                new Promise<void>((resolve) => {
                    server.close(() => resolve());
                }),
        ),
    );
    servers.clear();
});

describe("Claude user message after a completed tool batch", () => {
    it("delivers every result from a parallel tool batch before continuing inference", async () => {
        const firstPrompt = "RUN_TWO_CLAUDE_TOOLS";
        const completed = "CLAUDE_PARALLEL_TOOL_BATCH_CONTINUED";
        let sawCompleteToolResultBatch = false;
        const server = createServer((request, response) => {
            void (async () => {
                if (request.url !== "/v1/messages?beta=true") {
                    response.writeHead(404).end("Unexpected request.");
                    return;
                }
                const payload = JSON.parse(await requestText(request)) as AnthropicRequestPayload;
                const messages = JSON.stringify(payload.messages);
                if (messages.includes("tool_result")) {
                    sawCompleteToolResultBatch =
                        messages.includes("parallel-bash-first") &&
                        messages.includes("parallel-bash-second");
                    await writeStream(response, textEvents(payload.model, completed));
                    return;
                }
                if (messages.includes(firstPrompt)) {
                    await writeStream(response, parallelBashToolEvents(payload));
                    return;
                }
                await writeStream(
                    response,
                    textEvents(payload.model, "UNEXPECTED_PARALLEL_TOOL_REQUEST"),
                );
            })().catch((error: unknown) => {
                if (!response.headersSent) response.writeHead(500);
                response.end(error instanceof Error ? error.message : String(error));
            });
        });
        servers.add(server);
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "0.0.0.0", () => {
                server.off("error", reject);
                resolve();
            });
        });
        const address = server.address() as AddressInfo;
        const gym = await createGym({
            mode: "docker",
            environment: {
                ANTHROPIC_API_KEY: "gym-placeholder-key",
                ANTHROPIC_BASE_URL: `http://host.docker.internal:${address.port}`,
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                DISABLE_TELEMETRY: "1",
                NO_PROXY: "host.docker.internal",
            },
            modelId: "anthropic/sonnet-5",
            providerId: "claude",
            timeoutMs: 30_000,
        });
        running.add(gym);

        gym.terminal.type(firstPrompt);
        gym.terminal.press("enter");

        const screen = await gym.terminal.waitForText(completed, 30_000);
        expect(screen.text).toContain("Ran echo first");
        expect(screen.text).toContain("Ran echo second");
        expect(sawCompleteToolResultBatch).toBe(true);
    }, 120_000);

    it("replays the durable transcript instead of continuing a query waiting on tools", async () => {
        const firstPrompt = "RUN_CLAUDE_TOOL_BATCH";
        const followupPrompt = "REPORT_LAST_MESSAGES";
        const recovered = "CLAUDE_REPLAYED_AFTER_TOOL_BATCH";
        let releaseContinuation!: () => void;
        const continuationGate = new Promise<void>((resolve) => {
            releaseContinuation = resolve;
        });
        const server = createServer((request, response) => {
            void (async () => {
                if (request.url !== "/v1/messages?beta=true") {
                    response.writeHead(404).end("Unexpected request.");
                    return;
                }
                const payload = JSON.parse(await requestText(request)) as AnthropicRequestPayload;
                const messages = JSON.stringify(payload.messages);
                if (messages.includes(followupPrompt)) {
                    await writeStream(response, textEvents(payload.model, recovered));
                    return;
                }
                if (messages.includes("tool_result")) {
                    await continuationGate;
                    await writeStream(response, textEvents(payload.model, "STALE_CONTINUATION"));
                    return;
                }
                await writeStream(response, bashToolEvents(payload));
            })().catch((error: unknown) => {
                if (!response.headersSent) response.writeHead(500);
                response.end(error instanceof Error ? error.message : String(error));
            });
        });
        servers.add(server);
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "0.0.0.0", () => {
                server.off("error", reject);
                resolve();
            });
        });
        const address = server.address() as AddressInfo;
        const gym = await createGym({
            mode: "docker",
            environment: {
                ANTHROPIC_API_KEY: "gym-placeholder-key",
                ANTHROPIC_BASE_URL: `http://host.docker.internal:${address.port}`,
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                DISABLE_TELEMETRY: "1",
                NO_PROXY: "host.docker.internal",
            },
            modelId: "anthropic/sonnet-5",
            providerId: "claude",
            timeoutMs: 30_000,
        });
        running.add(gym);

        gym.terminal.type(firstPrompt);
        gym.terminal.press("enter");
        await gym.terminal.waitForText("CLAUDE_TOOL_BATCH_COMPLETE", 30_000);

        gym.terminal.type(followupPrompt);
        gym.terminal.press("enter");
        await gym.terminal.waitForText(followupPrompt, 30_000);
        releaseContinuation();

        const screen = await gym.terminal.waitForText(recovered, 30_000);
        expect(screen.text).toContain(recovered);
        expect(screen.text).not.toContain("[ede_diagnostic]");
    }, 120_000);

    it("interrupts every parallel tool and accepts the next prompt without SDK cleanup", async () => {
        const firstPrompt = "START_PARALLEL_CLAUDE_ABORT";
        const childPrompt = "BLOCK_CLAUDE_CHILD_UNTIL_ABORT";
        const followupPrompt = "CONTINUE_AFTER_PARALLEL_CLAUDE_ABORT";
        const recovered = "CLAUDE_CONTINUED_AFTER_IMMEDIATE_ABORT";
        let resolveChildStarted = () => {};
        const childStarted = new Promise<void>((resolve) => {
            resolveChildStarted = resolve;
        });
        const server = createServer((request, response) => {
            void (async () => {
                if (request.url !== "/v1/messages?beta=true") {
                    response.writeHead(404).end("Unexpected request.");
                    return;
                }
                const payload = JSON.parse(await requestText(request)) as AnthropicRequestPayload;
                const messages = JSON.stringify(payload.messages);
                if (messages.includes(followupPrompt)) {
                    await writeStream(response, textEvents(payload.model, recovered));
                    return;
                }
                if (messages.includes(childPrompt)) {
                    resolveChildStarted();
                    response.writeHead(200, { "content-type": "text/event-stream" });
                    response.write(`event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`);
                    return;
                }
                if (messages.includes(firstPrompt)) {
                    await writeStream(response, parallelToolEvents(payload, childPrompt));
                    return;
                }
                await writeStream(
                    response,
                    textEvents(payload.model, "UNEXPECTED_CLAUDE_ABORT_REQUEST"),
                );
            })().catch((error: unknown) => {
                if (!response.headersSent) response.writeHead(500);
                response.end(error instanceof Error ? error.message : String(error));
            });
        });
        servers.add(server);
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "0.0.0.0", () => {
                server.off("error", reject);
                resolve();
            });
        });
        const address = server.address() as AddressInfo;
        const gym = await createGym({
            mode: "docker",
            environment: {
                ANTHROPIC_API_KEY: "gym-placeholder-key",
                ANTHROPIC_BASE_URL: `http://host.docker.internal:${address.port}`,
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                DISABLE_TELEMETRY: "1",
                NO_PROXY: "host.docker.internal",
            },
            modelId: "anthropic/sonnet-5",
            providerId: "claude",
            timeoutMs: 30_000,
        });
        running.add(gym);

        gym.terminal.type(firstPrompt);
        gym.terminal.press("enter");
        await childStarted;
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("sleep 60") &&
                snapshot.text.includes("Blocking Claude agent") &&
                snapshot.text.includes("esc to interrupt"),
            "both parallel Claude tools to be active",
            30_000,
        );

        gym.terminal.press("escape");
        const interrupted = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Session interrupted") &&
                snapshot.text.includes("Stopped sleep 60") &&
                snapshot.text.includes("Stopped Blocking Claude agent") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                !snapshot.text.includes("esc to interrupt"),
            "all tools and the Claude run to stop together",
            5_000,
        );
        expect(interrupted.text).not.toContain("Waiting for approval");

        gym.terminal.type(followupPrompt);
        gym.terminal.press("enter");
        const continued = await gym.terminal.waitForText(recovered, 10_000);
        expect(continued.text).toContain(recovered);
    }, 120_000);
});

function parallelToolEvents(
    payload: AnthropicRequestPayload,
    childPrompt: string,
): readonly Record<string, unknown>[] {
    const bashName = payload.tools?.find((tool) => tool.name.endsWith("Bash"))?.name ?? "Bash";
    const agentName = payload.tools?.find((tool) => tool.name.endsWith("Agent"))?.name ?? "Agent";
    return messageEvents(payload.model, [
        {
            type: "content_block_start",
            index: 0,
            content_block: {
                type: "thinking",
                thinking: "",
                signature: "gym-parallel-abort-signature",
            },
        },
        {
            type: "content_block_delta",
            index: 0,
            delta: {
                type: "signature_delta",
                signature: "gym-parallel-abort-signature",
            },
        },
        { type: "content_block_stop", index: 0 },
        {
            type: "content_block_start",
            index: 1,
            content_block: {
                type: "tool_use",
                id: "parallel-bash",
                name: bashName,
                input: {},
                caller: { type: "direct" },
            },
        },
        {
            type: "content_block_delta",
            index: 1,
            delta: {
                type: "input_json_delta",
                partial_json: '{"command":"sleep 60"}',
            },
        },
        { type: "content_block_stop", index: 1 },
        {
            type: "content_block_start",
            index: 2,
            content_block: {
                type: "tool_use",
                id: "parallel-agent",
                name: agentName,
                input: {},
                caller: { type: "direct" },
            },
        },
        {
            type: "content_block_delta",
            index: 2,
            delta: {
                type: "input_json_delta",
                partial_json: JSON.stringify({
                    description: "Blocking Claude agent",
                    prompt: childPrompt,
                    run_in_background: false,
                }),
            },
        },
        { type: "content_block_stop", index: 2 },
        {
            type: "message_delta",
            delta: { stop_reason: "tool_use", stop_sequence: null, stop_details: null },
            usage: { output_tokens: 1 },
            context_management: { applied_edits: [] },
        },
        { type: "message_stop" },
    ]);
}

function bashToolEvents(payload: AnthropicRequestPayload): readonly Record<string, unknown>[] {
    const bashName = payload.tools?.find((tool) => tool.name.endsWith("Bash"))?.name ?? "Bash";
    return messageEvents(payload.model, [
        {
            type: "content_block_start",
            index: 0,
            content_block: {
                type: "thinking",
                thinking: "",
                signature: "gym-thinking-signature",
            },
        },
        {
            type: "content_block_delta",
            index: 0,
            delta: {
                type: "signature_delta",
                signature: "gym-thinking-signature",
            },
        },
        { type: "content_block_stop", index: 0 },
        {
            type: "content_block_start",
            index: 1,
            content_block: {
                type: "tool_use",
                id: "call-1",
                name: bashName,
                input: {},
                caller: { type: "direct" },
            },
        },
        {
            type: "content_block_delta",
            index: 1,
            delta: {
                type: "input_json_delta",
                partial_json: '{"command":"echo CLAUDE_TOOL_BATCH_COMPLETE"}',
            },
        },
        { type: "content_block_stop", index: 1 },
        {
            type: "message_delta",
            delta: { stop_reason: "tool_use", stop_sequence: null, stop_details: null },
            usage: { output_tokens: 1 },
            context_management: { applied_edits: [] },
        },
        { type: "message_stop" },
    ]);
}

function parallelBashToolEvents(
    payload: AnthropicRequestPayload,
): readonly Record<string, unknown>[] {
    const bashName = payload.tools?.find((tool) => tool.name.endsWith("Bash"))?.name ?? "Bash";
    return messageEvents(payload.model, [
        {
            type: "content_block_start",
            index: 0,
            content_block: {
                type: "tool_use",
                id: "parallel-bash-first",
                name: bashName,
                input: {},
                caller: { type: "direct" },
            },
        },
        {
            type: "content_block_delta",
            index: 0,
            delta: {
                type: "input_json_delta",
                partial_json: '{"command":"echo first"}',
            },
        },
        { type: "content_block_stop", index: 0 },
        {
            type: "content_block_start",
            index: 1,
            content_block: {
                type: "tool_use",
                id: "parallel-bash-second",
                name: bashName,
                input: {},
                caller: { type: "direct" },
            },
        },
        {
            type: "content_block_delta",
            index: 1,
            delta: {
                type: "input_json_delta",
                partial_json: '{"command":"echo second"}',
            },
        },
        { type: "content_block_stop", index: 1 },
        {
            type: "message_delta",
            delta: { stop_reason: "tool_use", stop_sequence: null, stop_details: null },
            usage: { output_tokens: 1 },
            context_management: { applied_edits: [] },
        },
        { type: "message_stop" },
    ]);
}

function textEvents(model: string | undefined, text: string): readonly Record<string, unknown>[] {
    return messageEvents(model, [
        {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
        },
        {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text },
        },
        { type: "content_block_stop", index: 0 },
        {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 1 },
        },
        { type: "message_stop" },
    ]);
}

function messageEvents(
    model: string | undefined,
    contentEvents: readonly Record<string, unknown>[],
): readonly Record<string, unknown>[] {
    return [
        {
            type: "message_start",
            message: {
                id: "msg_gym_claude_tool_batch",
                type: "message",
                role: "assistant",
                model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: {
                    input_tokens: 1,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                    output_tokens: 1,
                },
            },
        },
        ...contentEvents,
    ];
}

async function writeStream(
    response: ServerResponse,
    events: readonly Record<string, unknown>[],
): Promise<void> {
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of events) {
        if (response.destroyed) return;
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    response.end();
}

async function requestText(request: AsyncIterable<unknown>): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks).toString("utf8");
}

interface AnthropicRequestPayload {
    messages?: unknown;
    model?: string;
    tools?: readonly { name: string }[];
}
