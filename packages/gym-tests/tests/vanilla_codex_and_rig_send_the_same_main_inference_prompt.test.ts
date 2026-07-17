import { zstdDecompressSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { createPermissionInstructions } from "../../rig/sources/agent/createPermissionInstructions.js";
import { GPT_5_4_SYSTEM_PROMPT } from "../../rig/sources/agent/prompts/gpt54SystemPrompt.js";
import { GPT_5_5_SYSTEM_PROMPT } from "../../rig/sources/agent/prompts/gpt55SystemPrompt.js";
import { GPT_5_6_SOL_SYSTEM_PROMPT } from "../../rig/sources/agent/prompts/gpt56SolSystemPrompt.js";
import { GPT_5_6_TERRA_SYSTEM_PROMPT } from "../../rig/sources/agent/prompts/gpt56TerraSystemPrompt.js";
import type { AnyDefinedTool } from "../../rig/sources/agent/types.js";
import { createDefaultInstructions } from "../../rig/sources/runtime/createDefaultInstructions.js";
import { CODEX_ULTRA_INSTRUCTIONS } from "../../rig/sources/providers/codexUltraInstructions.js";
import { codexCollaborationTools, codexTools } from "../../rig/sources/tools/codex/index.js";
import { goalTools } from "../../rig/sources/tools/goals/index.js";
import {
    createGym,
    type Gym,
    type InterceptedHttpExchange,
    type InterceptedHttpRequest,
} from "@slopus/rig-gym";

const BLOCK_MARKER = "RIG_GYM_BLOCKED_BEFORE_CODEX";
const UNEXPECTED_BLOCK_MARKER = "RIG_GYM_UNEXPECTED_CODEX_REQUEST";
const CODEX_BASE_URL = "{{HTTP_PROXY_URL}}/backend-api";
const DIRECT_OPTIONS_PATH = "direct-codex-options.json";
const DIRECT_PROBE_PATH = "direct-codex-probe.mjs";
const USER_PROMPT = "CODEX_PAYLOAD_INSPECTION_MARKER";
const running = new Set<Gym>();

const codexModels = [
    {
        name: "GPT-5.6 Sol",
        rigModelId: "openai/gpt-5.6-sol",
        systemPrompt: GPT_5_6_SOL_SYSTEM_PROMPT,
        wireModelId: "gpt-5.6-sol",
    },
    {
        name: "GPT-5.6 Terra",
        rigModelId: "openai/gpt-5.6-terra",
        systemPrompt: GPT_5_6_TERRA_SYSTEM_PROMPT,
        wireModelId: "gpt-5.6-terra",
    },
    {
        name: "GPT-5.6 Luna",
        rigModelId: "openai/gpt-5.6-luna",
        systemPrompt: GPT_5_6_TERRA_SYSTEM_PROMPT,
        wireModelId: "gpt-5.6-luna",
    },
    {
        name: "GPT-5.5",
        rigModelId: "openai/gpt-5.5",
        systemPrompt: GPT_5_5_SYSTEM_PROMPT,
        wireModelId: "gpt-5.5",
    },
    {
        name: "GPT-5.4",
        rigModelId: "openai/gpt-5.4",
        systemPrompt: GPT_5_4_SYSTEM_PROMPT,
        wireModelId: "gpt-5.4",
    },
] as const satisfies readonly CodexModelCase[];
const ultraCodexModels = codexModels.slice(0, 2);

const rigTools = [...codexTools, ...codexCollaborationTools, ...goalTools] as const;

const fakeAccessToken = fakeJwt({
    "https://api.openai.com/auth": {
        chatgpt_account_id: "account-gym",
        chatgpt_plan_type: "pro",
        chatgpt_user_id: "user-gym",
    },
    exp: 4_102_444_800,
});

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("vanilla Codex and Rig main inference prompts", () => {
    it.each(codexModels)(
        "uses the compiled $name system prompt and verifies Rig's complete request",
        async (modelCase) => {
            const gym = await createBlockedCodexGym({
                effort: "medium",
                modelId: modelCase.wireModelId,
                rigModelId: modelCase.rigModelId,
            });
            running.add(gym);

            gym.terminal.type(USER_PROMPT);
            gym.terminal.press("enter");
            const rigExchange = await waitForMainExchange(gym, modelCase.wireModelId);
            const directStartIndex = gym.httpProxy!.exchanges.length;

            await gym.runInContainer("node", [`/workspace/${DIRECT_PROBE_PATH}`], {
                timeoutMs: 30_000,
            });
            const directExchange = await waitForMainExchange(
                gym,
                modelCase.wireModelId,
                directStartIndex,
            );

            expect(blockedWithoutForwarding(rigExchange)).toBe(true);
            expect(blockedWithoutForwarding(directExchange)).toBe(true);
            const rigPayload = requestPayload(rigExchange.request);
            const directPayload = requestPayload(directExchange.request);
            expect(compiledPromptAndTools(directPayload)).not.toEqual(
                compiledPromptAndTools(rigPayload),
            );
            expectSharedInferenceSettings(directPayload, rigPayload, modelCase.wireModelId);
            expectCompiledCodexPrompt(directPayload, modelCase);
            expectExactRigPayload(rigPayload, modelCase, "medium");
        },
        120_000,
    );

    it.each(ultraCodexModels)(
        "checks the complete $name Ultra request against compiled Codex and Rig",
        async (modelCase) => {
            const gym = await createBlockedCodexGym({
                effort: "ultra",
                modelId: modelCase.wireModelId,
                rigModelId: modelCase.rigModelId,
            });
            running.add(gym);

            gym.terminal.type(USER_PROMPT);
            gym.terminal.press("enter");
            const rigExchange = await waitForMainExchange(gym, modelCase.wireModelId);

            const mediumStartIndex = gym.httpProxy!.exchanges.length;
            await gym.runInContainer("node", [`/workspace/${DIRECT_PROBE_PATH}`, "medium"], {
                timeoutMs: 30_000,
            });
            const directMediumExchange = await waitForMainExchange(
                gym,
                modelCase.wireModelId,
                mediumStartIndex,
            );

            const ultraStartIndex = gym.httpProxy!.exchanges.length;
            await gym.runInContainer("node", [`/workspace/${DIRECT_PROBE_PATH}`, "ultra"], {
                timeoutMs: 30_000,
            });
            const directUltraExchange = await waitForMainExchange(
                gym,
                modelCase.wireModelId,
                ultraStartIndex,
            );

            const rigPayload = requestPayload(rigExchange.request);
            const directMediumPayload = requestPayload(directMediumExchange.request);
            const directUltraPayload = requestPayload(directUltraExchange.request);
            const mediumInput = JSON.stringify(directMediumPayload.input);
            const ultraInput = JSON.stringify(directUltraPayload.input);
            expect(mediumInput).toContain("Do not spawn sub-agents unless the user");
            expect(ultraInput).toContain("Proactive multi-agent delegation is active");
            expect(compiledPromptSurface(directUltraPayload)).not.toEqual(
                compiledPromptSurface(directMediumPayload),
            );
            expect(normalizedCompiledPromptSurface(directUltraPayload)).toEqual(
                normalizedCompiledPromptSurface(directMediumPayload),
            );
            expect(directUltraPayload.reasoning).toMatchObject({ effort: "max" });
            expect(rigPayload.reasoning).toMatchObject({ effort: "max" });
            expectCompiledCodexPrompt(directUltraPayload, modelCase);
            expectExactRigPayload(rigPayload, modelCase, "ultra");
        },
        120_000,
    );
});

async function createBlockedCodexGym(options: CodexCase): Promise<Gym> {
    return createGym({
        environment: {
            CODEX_HOME: "/home/rig/.codex",
            DISABLE_TELEMETRY: "1",
            NO_PROXY: "host.docker.internal",
            OPENAI_API_KEY: fakeAccessToken,
            RIG_CODEX_BASE_URL: CODEX_BASE_URL,
            RIG_CODEX_TRANSPORT: "sse",
            RIG_EFFORT: options.effort,
        },
        files: {
            [DIRECT_OPTIONS_PATH]: JSON.stringify({
                effort: options.effort,
                modelId: options.modelId,
                userPrompt: USER_PROMPT,
            }),
            [DIRECT_PROBE_PATH]: directCodexProbeSource(),
        },
        homeFiles: {
            ".codex/auth.json": JSON.stringify({
                auth_mode: "chatgpt",
                tokens: {
                    access_token: fakeAccessToken,
                    account_id: "account-gym",
                    id_token: fakeAccessToken,
                    refresh_token: "gym-refresh-token",
                },
            }),
        },
        httpProxy: {
            handler(request) {
                if (request.method === "POST" && isResponsesPath(request.url)) {
                    return {
                        response: {
                            body: JSON.stringify({
                                error: { message: BLOCK_MARKER, type: "invalid_request_error" },
                            }),
                            headers: { "content-type": "application/json" },
                            status: 400,
                        },
                    };
                }
                return {
                    response: {
                        body: `${UNEXPECTED_BLOCK_MARKER}: ${request.method} ${request.url}`,
                        status: 400,
                    },
                };
            },
        },
        modelId: options.rigModelId,
        providerId: "codex",
        timeoutMs: 30_000,
    });
}

function directCodexProbeSource(): string {
    return String.raw`
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const options = JSON.parse(await readFile("/workspace/${DIRECT_OPTIONS_PATH}", "utf8"));
const effort = process.argv[2] ?? options.effort;
const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--model",
    options.modelId,
    "--config",
    "model_provider=\"gym\"",
    "--config",
    "model_providers.gym={ name = \"Gym\", base_url = " +
        JSON.stringify(process.env.RIG_CODEX_BASE_URL + "/codex") +
        ", wire_api = \"responses\", requires_openai_auth = true, supports_websockets = false }",
    "--config",
    "model_reasoning_effort=" + JSON.stringify(effort),
    "--config",
    "features.responses_websockets=false",
    "--config",
    "features.responses_websockets_v2=false",
    "--config",
    "web_search=\"disabled\"",
    options.userPrompt,
];
const child = spawn("/app/gym/node_modules/.bin/codex", args, {
    cwd: "/workspace",
    env: {
        ...process.env,
        CODEX_HOME: "/home/rig/.codex",
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "codex_sdk_ts",
    },
});
child.stdin.end();
let output = "";
let sawBlockedRequest = false;
const appendOutput = (chunk) => {
    output += chunk;
    if (!sawBlockedRequest && output.includes("${BLOCK_MARKER}")) {
        sawBlockedRequest = true;
        child.kill("SIGTERM");
    }
};
child.stdout.on("data", appendOutput);
child.stderr.on("data", appendOutput);
const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
});
const exitCode = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 5_000)),
]);
if (exitCode === "timeout") {
    child.kill("SIGTERM");
    await exited;
    throw new Error("Compiled Codex timed out before reaching inference.\n" + output);
}
if (!sawBlockedRequest) {
    throw new Error("Compiled Codex did not stop at the blocked request.\n" + output);
}
console.log("Compiled Codex request was blocked as expected.");
`;
}

async function waitForMainExchange(
    gym: Gym,
    modelId: string,
    startIndex = 0,
): Promise<InterceptedHttpExchange> {
    let exchange: InterceptedHttpExchange | undefined;
    try {
        await expect
            .poll(
                () => {
                    exchange = gym.httpProxy?.exchanges.slice(startIndex).find((candidate) => {
                        if (candidate.request.method !== "POST") return false;
                        if (!isResponsesPath(candidate.request.url)) return false;
                        const payload = requestPayload(candidate.request);
                        return (
                            payload.model === modelId &&
                            !String(payload.instructions).startsWith(
                                "Create settled session metadata",
                            ) &&
                            JSON.stringify(payload).includes(USER_PROMPT)
                        );
                    });
                    return exchange;
                },
                { timeout: 30_000 },
            )
            .toBeDefined();
    } catch (error) {
        const screen = await gym.terminal.snapshot();
        const requests = gym.httpProxy?.exchanges.slice(startIndex).map((candidate) => ({
            method: candidate.request.method,
            url: candidate.request.url,
        }));
        throw new Error(
            `No main Codex request was captured.\nScreen:\n${screen.text}\nRequests:\n${JSON.stringify(requests, null, 2)}`,
            { cause: error },
        );
    }
    return exchange!;
}

function isResponsesPath(url: string): boolean {
    return new URL(url).pathname.endsWith("/codex/responses");
}

function blockedWithoutForwarding(exchange: InterceptedHttpExchange): boolean {
    return (
        exchange.forwardedRequest === undefined &&
        exchange.responseSource === "interceptor" &&
        exchange.response?.status === 400 &&
        Buffer.from(exchange.response.body).toString("utf8").includes(BLOCK_MARKER)
    );
}

function expectSharedInferenceSettings(
    directPayload: CodexRequestPayload,
    rigPayload: CodexRequestPayload,
    modelId: string,
): void {
    expect(directPayload).toMatchObject({
        include: ["reasoning.encrypted_content"],
        model: modelId,
        store: false,
        stream: true,
        text: { verbosity: "low" },
    });
    expect(rigPayload).toMatchObject({
        include: directPayload.include,
        model: directPayload.model,
        store: directPayload.store,
        stream: directPayload.stream,
        text: directPayload.text,
    });
    expect(directPayload.reasoning).toMatchObject({ effort: "medium" });
    expect(rigPayload.reasoning).toMatchObject({ effort: "medium" });
}

function compiledPromptSurface(payload: CodexRequestPayload): Record<string, unknown> {
    const {
        client_metadata: _clientMetadata,
        prompt_cache_key: _promptCacheKey,
        reasoning: _reasoning,
        ...promptSurface
    } = payload;
    return promptSurface;
}

function compiledPromptAndTools(payload: CodexRequestPayload): Record<string, unknown> {
    return {
        input: payload.input,
        instructions: payload.instructions,
        tools: payload.tools,
    };
}

function normalizedCompiledPromptSurface(payload: CodexRequestPayload): Record<string, unknown> {
    return JSON.parse(
        JSON.stringify(compiledPromptSurface(payload)).replace(
            /<multi_agent_mode>[\s\S]*?<\/multi_agent_mode>/gu,
            "<multi_agent_mode>normalized</multi_agent_mode>",
        ),
    ) as Record<string, unknown>;
}

function expectCompiledCodexPrompt(payload: CodexRequestPayload, modelCase: CodexModelCase): void {
    const serializedInput = JSON.stringify(payload.input);
    expect(serializedInput).toContain(USER_PROMPT);
    expect(compiledCodexSystemPrompt(payload, modelCase)).toBe(modelCase.systemPrompt);
    if (modelCase.wireModelId.startsWith("gpt-5.6")) {
        expect(serializedInput).toContain("You are Codex");
        expect(payload.instructions).toBeUndefined();
        expect(payload.tools).toBeUndefined();

        const embeddedToolNames = (payload.input ?? []).flatMap((item) =>
            item.role === "developer" && Array.isArray(item.tools)
                ? item.tools.flatMap((tool) => (typeof tool.name === "string" ? [tool.name] : []))
                : [],
        );
        expect(embeddedToolNames).toEqual(expect.arrayContaining(["exec", "wait"]));
        if (modelCase.wireModelId === "gpt-5.6-sol" || modelCase.wireModelId === "gpt-5.6-terra") {
            expect(embeddedToolNames).toContain("collaboration");
        }
    } else {
        expect(serializedInput).not.toContain("You are Codex");
        expect(payload.instructions).toContain("You are Codex");
        expect(payload.tools).toBeDefined();

        const topLevelToolNames = (payload.tools ?? []).flatMap((tool) =>
            typeof tool.name === "string" ? [tool.name] : [],
        );
        expect(topLevelToolNames).toEqual(
            expect.arrayContaining(["exec_command", "write_stdin", "apply_patch"]),
        );
    }
    expect(payload.client_metadata).toBeDefined();
}

function compiledCodexSystemPrompt(
    payload: CodexRequestPayload,
    modelCase: CodexModelCase,
): string | undefined {
    if (!modelCase.wireModelId.startsWith("gpt-5.6")) {
        return typeof payload.instructions === "string" ? payload.instructions : undefined;
    }

    for (const item of payload.input ?? []) {
        if (item.role !== "developer" || !Array.isArray(item.content)) continue;
        const text = item.content
            .map((part) => (typeof part.text === "string" ? part.text : ""))
            .join("");
        if (text.startsWith("You are Codex")) return text;
    }
    return undefined;
}

function expectExactRigPayload(
    payload: CodexRequestPayload,
    modelCase: CodexModelCase,
    thinking: "medium" | "ultra",
): void {
    const { prompt_cache_key: _promptCacheKey, ...stablePayload } = payload;
    const systemPrompt = [
        modelCase.systemPrompt,
        createDefaultInstructions("/workspace"),
        createPermissionInstructions("full_access"),
        ...(thinking === "ultra" ? [CODEX_ULTRA_INSTRUCTIONS] : []),
    ].join("\n\n");

    expect(stablePayload).toEqual({
        include: ["reasoning.encrypted_content"],
        input: [
            {
                content: [{ text: USER_PROMPT, type: "input_text" }],
                role: "user",
            },
        ],
        instructions: systemPrompt,
        model: modelCase.wireModelId,
        parallel_tool_calls: true,
        reasoning: { effort: thinking === "ultra" ? "max" : thinking, summary: "auto" },
        store: false,
        stream: true,
        text: { verbosity: "low" },
        tool_choice: "auto",
        tools: expectedRigTools(rigTools),
    });
}

function expectedRigTools(tools: readonly AnyDefinedTool[]): readonly CodexApiTool[] {
    return tools.map((tool) => ({
        description: tool.description,
        name: tool.name,
        parameters: JSON.parse(JSON.stringify(tool.arguments)) as unknown,
        strict: null,
        type: "function",
    }));
}

function requestPayload(request: InterceptedHttpRequest): CodexRequestPayload {
    const body = Buffer.from(request.body);
    const encoding = request.headers["content-encoding"];
    const decoded = encoding === "zstd" ? zstdDecompressSync(body) : body;
    return JSON.parse(decoded.toString("utf8")) as CodexRequestPayload;
}

function fakeJwt(payload: Record<string, unknown>): string {
    return [
        Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
        Buffer.from(JSON.stringify(payload)).toString("base64url"),
        "gym-signature",
    ].join(".");
}

interface CodexCase {
    effort: string;
    modelId: string;
    rigModelId: string;
}

interface CodexModelCase {
    name: string;
    rigModelId: string;
    systemPrompt: string;
    wireModelId: string;
}

interface CodexApiTool extends Record<string, unknown> {
    description: string;
    name: string;
    parameters: unknown;
    strict: null;
    type: "function";
}

interface CodexInputItem extends Record<string, unknown> {
    content?: readonly { text?: unknown }[];
    role?: unknown;
    tools?: readonly { name?: unknown }[];
}

interface CodexRequestPayload extends Record<string, unknown> {
    client_metadata?: unknown;
    include?: unknown;
    input?: readonly CodexInputItem[];
    instructions?: unknown;
    model?: unknown;
    prompt_cache_key?: unknown;
    reasoning?: unknown;
    store?: unknown;
    stream?: unknown;
    text?: unknown;
    tools?: readonly { name?: unknown }[];
}
