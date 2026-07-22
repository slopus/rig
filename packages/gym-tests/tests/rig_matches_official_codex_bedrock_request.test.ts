import { afterEach, describe, expect, it } from "vitest";

import {
    createGym,
    type Gym,
    type InterceptedHttpExchange,
    type InterceptedHttpRequest,
} from "@slopus/rig-gym";

const BLOCK_MARKER = "BEDROCK_REQUEST_CAPTURED";
const USER_PROMPT = "BEDROCK_PARITY_MARKER";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Rig and official Codex Bedrock requests", () => {
    it("send the same Sol prompt, tools, and Responses controls", async () => {
        const gym = await createGym({
            mode: "docker",
            entrypoint: [
                "/bin/sh",
                "-lc",
                'sed -i "s|BEDROCK_GYM_ENDPOINT|$BEDROCK_GYM_ENDPOINT|g" /home/rig/.rig/config.toml /home/rig/.codex/config.toml\nexec node /app/packages/rig/dist/main.js',
            ],
            environment: {
                AWS_BEARER_TOKEN_BEDROCK: "fake-bedrock-token",
                BEDROCK_GYM_ENDPOINT: "{{HTTP_PROXY_URL}}/openai/v1",
                CODEX_HOME: "/home/rig/.codex",
                NO_PROXY: "host.docker.internal",
                RIG_EFFORT: "low",
            },
            files: { "direct-bedrock-probe.mjs": directProbe() },
            homeFiles: {
                ".codex/config.toml": codexConfig(),
                ".rig/config.toml": rigConfig(),
            },
            httpProxy: {
                handler(request) {
                    if (request.method === "POST" && isResponsesRequest(request)) {
                        const requestPayload = payload(request);
                        if (
                            JSON.stringify(requestPayload).includes(USER_PROMPT) &&
                            !requestPayload.input?.some(
                                (item) => item.type === "tool_search_output",
                            )
                        ) {
                            return { response: toolSearchStream() };
                        }
                        return {
                            response: {
                                body: JSON.stringify({ error: { message: BLOCK_MARKER } }),
                                headers: { "content-type": "application/json" },
                                status: 400,
                            },
                        };
                    }
                    return { response: { body: "Unexpected request", status: 404 } };
                },
            },
            modelId: "openai/gpt-5.6-sol",
            permissionMode: "workspace_write",
            providerId: "bedrock",
            timeoutMs: 30_000,
        });
        running.add(gym);

        gym.terminal.type(USER_PROMPT);
        gym.terminal.press("enter");
        const rigExchange = await waitForExchange(gym, 0, false);
        const rigContinuation = await waitForExchange(gym, 0, true);
        const directStart = gym.httpProxy!.exchanges.length;
        await gym.runInContainer("node", ["/workspace/direct-bedrock-probe.mjs"], {
            timeoutMs: 30_000,
        });
        const officialExchange = await waitForExchange(gym, directStart, false);
        const officialContinuation = await waitForExchange(gym, directStart, true);

        const rig = payload(rigExchange.request);
        const official = payload(officialExchange.request);
        for (const header of [
            "x-amzn-mantle-client-agent",
            "x-codex-beta-features",
            "x-codex-window-id",
            "x-codex-turn-metadata",
            "x-client-request-id",
            "session-id",
            "thread-id",
            "originator",
        ]) {
            expect(rigExchange.request.headers[header]).toBeDefined();
        }
        expect(rig.instructions).toBe(official.instructions);
        expect(rig.tools).toEqual(official.tools);
        expect(coreRequest(rig)).toEqual(coreRequest(official));
        expect(rig.tools?.map((tool) => tool.type)).toEqual([
            "function",
            "function",
            "function",
            "function",
            "custom",
            "function",
            "tool_search",
        ]);
        expect(rig.input?.map((item) => item.role)).toEqual(["developer", "user", "user"]);
        expect(rig.input?.at(-1)).toEqual(official.input?.at(-1));
        const rigSecond = payload(rigContinuation.request);
        const officialSecond = payload(officialContinuation.request);
        expect(normalizeDeferredToolOrder(rigSecond.input?.slice(-2))).toEqual(
            normalizeDeferredToolOrder(officialSecond.input?.slice(-2)),
        );
        expect(rigSecond.input?.at(-1)).toMatchObject({
            type: "tool_search_output",
            execution: "client",
            status: "completed",
            tools: [
                {
                    type: "namespace",
                    name: "multi_agent_v1",
                    tools: [
                        { name: "spawn_agent", defer_loading: true },
                        { name: "close_agent", defer_loading: true },
                        { name: "resume_agent", defer_loading: true },
                        { name: "wait_agent", defer_loading: true },
                        { name: "send_input", defer_loading: true },
                    ],
                },
            ],
        });
    }, 120_000);
});

function coreRequest(value: RequestPayload): Record<string, unknown> {
    return {
        include: value.include,
        model: value.model,
        parallel_tool_calls: value.parallel_tool_calls,
        reasoning: value.reasoning,
        store: value.store,
        stream: value.stream,
        text: value.text,
        tool_choice: value.tool_choice,
    };
}

function normalizeDeferredToolOrder(value: unknown): unknown {
    const cloned = structuredClone(value) as {
        tools?: { tools?: { name?: unknown }[] }[];
    }[];
    for (const item of cloned ?? []) {
        for (const namespace of item.tools ?? []) {
            namespace.tools?.sort((left, right) =>
                String(left.name).localeCompare(String(right.name)),
            );
        }
    }
    return cloned;
}

async function waitForExchange(
    gym: Gym,
    start: number,
    continuation: boolean,
): Promise<InterceptedHttpExchange> {
    let found: InterceptedHttpExchange | undefined;
    await expect
        .poll(
            () => {
                found = gym.httpProxy?.exchanges.slice(start).find((exchange) => {
                    if (!isResponsesRequest(exchange.request)) return false;
                    const requestPayload = payload(exchange.request);
                    return (
                        JSON.stringify(requestPayload).includes(USER_PROMPT) &&
                        requestPayload.input?.some((item) => item.type === "tool_search_output") ===
                            continuation
                    );
                });
                return found;
            },
            { timeout: 30_000 },
        )
        .toBeDefined();
    return found!;
}

function toolSearchStream() {
    const item = {
        type: "tool_search_call",
        id: "tool-search-item",
        call_id: "search-subagents-1",
        execution: "client",
        status: "completed",
        arguments: { query: "spawn and manage sub-agents", limit: 8 },
    };
    const response = {
        id: "response-tool-search",
        model: "openai.gpt-5.6-sol",
        status: "completed",
        usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 2,
            total_tokens: 12,
        },
    };
    const events = [
        { type: "response.created", response },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response },
    ];
    return {
        body: `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
        headers: { "content-type": "text/event-stream" },
        status: 200,
    };
}

function payload(request: InterceptedHttpRequest): RequestPayload {
    return JSON.parse(Buffer.from(request.body).toString("utf8")) as RequestPayload;
}

function isResponsesRequest(request: InterceptedHttpRequest): boolean {
    return new URL(request.url).pathname.endsWith("/openai/v1/responses");
}

function rigConfig(): string {
    return `
[providers.codex]
enabled = false

[providers.claude]
enabled = false

[providers.bedrock]
enabled = true
region = "us-east-1"

[providers.bedrock.model_overrides]
"openai/gpt-5.6-sol" = { endpoint = "BEDROCK_GYM_ENDPOINT" }
`;
}

function codexConfig(): string {
    return `
model_provider = "amazon-bedrock"
model = "openai.gpt-5.6-sol"
approval_policy = "never"

[model_providers.amazon-bedrock]
base_url = "BEDROCK_GYM_ENDPOINT"

[model_providers.amazon-bedrock.auth]
command = "/bin/echo"
args = ["fake-bedrock-token"]
`;
}

function directProbe(): string {
    return String.raw`
import { spawn } from "node:child_process";
const child = spawn("/app/gym/node_modules/.bin/codex", [
    "exec", "--ephemeral", "--json", "--skip-git-repo-check",
    "--sandbox", "workspace-write", "-C", "/workspace", ${JSON.stringify(USER_PROMPT)},
], { cwd: "/workspace", env: process.env });
child.stdin.end();
let output = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => output += chunk);
const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
});
if (!output.includes(${JSON.stringify(BLOCK_MARKER)})) {
    throw new Error("Official Codex did not reach the captured request (" + code + ").\n" + output);
}
`;
}

interface RequestPayload extends Record<string, unknown> {
    include?: unknown;
    input?: readonly { role?: unknown; type?: unknown }[];
    instructions?: unknown;
    model?: unknown;
    parallel_tool_calls?: unknown;
    reasoning?: unknown;
    store?: unknown;
    stream?: unknown;
    text?: unknown;
    tool_choice?: unknown;
    tools?: readonly { type?: unknown }[];
}
