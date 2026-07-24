import type { Options as ClaudeSdkOptions } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Type } from "@sinclair/typebox";

import type { SessionContext } from "@/core/SessionContext.js";
import type { SessionReasoningEffort } from "@/core/SessionRunRequest.js";
import type { SessionSkill } from "@/core/SessionSkill.js";
import type { SessionTool } from "@/core/SessionTool.js";
import type { ClaudeCredential } from "@/vendors/VendorCredential.js";
import { CLAUDE_SDK_PRIVACY_ENVIRONMENT } from "@/vendors/claude/claudeSdkPrivacyEnvironment.js";

const RIG_MCP_SERVER_NAME = "rig";

export function toClaudeSdkOptions(options: {
    abort?: AbortSignal;
    context: SessionContext;
    credential: ClaudeCredential;
    cwd: string;
    effort?: SessionReasoningEffort;
    env: NodeJS.ProcessEnv;
    model: string;
    pathToClaudeCodeExecutable?: string;
    sessionId: string;
    skills: readonly SessionSkill[];
    systemPrompt: string;
    tools: readonly SessionTool[];
    compaction?: boolean;
    callTool?: (name: string) => Promise<CallToolResult>;
    registerAbortCleanup?: (cleanup: () => void) => void;
}): ClaudeSdkOptions {
    const mcpToolNames = options.tools.map((tool) => `mcp__${RIG_MCP_SERVER_NAME}__${tool.name}`);
    const { abortController, cleanup } = toAbortController(options.abort);
    options.registerAbortCleanup?.(cleanup);
    return {
        allowedTools: mcpToolNames,
        cwd: options.cwd,
        mcpServers: {
            [RIG_MCP_SERVER_NAME]: createClaudeMcpServer(options.tools, options.callTool),
        },
        ...(options.compaction ? { maxTurns: 1 } : {}),
        model: options.model,
        ...(options.pathToClaudeCodeExecutable === undefined
            ? {}
            : { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }),
        env: {
            ...withoutClaudeCredentials(options.env),
            ...credentialEnvironment(options.credential),
            ...CLAUDE_SDK_PRIVACY_ENVIRONMENT,
            CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1",
            CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1",
            CLAUDE_CODE_DISABLE_ATTACHMENTS: "1",
            CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
            CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
            CLAUDE_CODE_MAX_RETRIES: "10",
        },
        extraArgs: options.compaction ? {} : { "disable-slash-commands": null },
        includePartialMessages: true,
        permissionMode: "dontAsk",
        persistSession: false,
        sessionId: options.sessionId,
        settingSources: [],
        settings: { env: CLAUDE_SDK_PRIVACY_ENVIRONMENT },
        skills: [],
        strictMcpConfig: true,
        systemPrompt: createSystemPrompt(options.systemPrompt, options.context, options.skills),
        tools: [],
        ...(abortController === undefined ? {} : { abortController }),
        ...thinkingOptions(options.effort),
    };
}

function createSystemPrompt(
    basePrompt: string,
    context: SessionContext,
    skills: readonly SessionSkill[],
): string {
    const systemMessages = context.messages
        .filter((message) => message.role === "system")
        .flatMap((message) => message.content)
        .join("\n\n");
    const skillPrompt =
        skills.length === 0
            ? ""
            : `<skills>\n${skills
                  .map(
                      (skill) =>
                          `<skill name="${skill.name}" source="${skill.source}" location="${skill.location}">${skill.description}</skill>`,
                  )
                  .join("\n")}\n</skills>`;
    return [basePrompt, context.instructions, systemMessages, skillPrompt]
        .filter(Boolean)
        .join("\n\n");
}

function credentialEnvironment(credential: ClaudeCredential): NodeJS.ProcessEnv {
    if (credential.name === "claude-api-key") {
        return { ANTHROPIC_API_KEY: credential.credential.apiKey };
    }
    if (credential.name === "claude-auth-token") {
        return { ANTHROPIC_AUTH_TOKEN: credential.credential.authToken };
    }
    return { CLAUDE_CODE_OAUTH_TOKEN: credential.credential.accessToken };
}

function createClaudeMcpServer(
    tools: readonly SessionTool[],
    callTool?: (name: string) => Promise<CallToolResult>,
) {
    for (const tool of tools) {
        if (tool.type !== "local") {
            throw new Error(`Claude SDK tools must execute locally: '${tool.name}'.`);
        }
    }
    const instance = new McpServer(
        {
            name: RIG_MCP_SERVER_NAME,
            version: "rig-providers",
        },
        {
            capabilities: { tools: {} },
        },
    );
    instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map((tool) => ({
            name: tool.name,
            description:
                tool.description === undefined || tool.description.trim().length === 0
                    ? `Run ${tool.name} through Rig.`
                    : tool.description,
            inputSchema: tool.parameters ?? Type.Object({}, { additionalProperties: false }),
        })),
    }));
    instance.server.setRequestHandler(CallToolRequestSchema, async (request) =>
        callTool === undefined
            ? {
                  content: [{ type: "text", text: "Tool execution is handled by Rig." }],
                  isError: true,
              }
            : callTool(request.params.name),
    );
    return {
        type: "sdk" as const,
        name: RIG_MCP_SERVER_NAME,
        instance,
    };
}

function toAbortController(signal: AbortSignal | undefined): {
    abortController?: AbortController;
    cleanup: () => void;
} {
    if (signal === undefined) return { cleanup: () => {} };
    const controller = new AbortController();
    if (signal.aborted) controller.abort(signal.reason);
    const abort = () => controller.abort(signal.reason);
    if (!signal.aborted) signal.addEventListener("abort", abort, { once: true });
    return {
        abortController: controller,
        cleanup: () => signal.removeEventListener("abort", abort),
    };
}

function withoutClaudeCredentials(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const sanitized = { ...env };
    delete sanitized.ANTHROPIC_API_KEY;
    delete sanitized.ANTHROPIC_AUTH_TOKEN;
    delete sanitized.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR;
    delete sanitized.CLAUDE_CODE_OAUTH_TOKEN;
    delete sanitized.CLAUDE_CODE_USE_BEDROCK;
    delete sanitized.CLAUDE_CODE_USE_FOUNDRY;
    delete sanitized.CLAUDE_CODE_USE_VERTEX;
    return sanitized;
}

function thinkingOptions(
    effort: SessionReasoningEffort | undefined,
): Partial<Pick<ClaudeSdkOptions, "effort" | "thinking">> {
    if (effort === undefined) return {};
    if (effort === "off") return { thinking: { type: "disabled" } };
    const sdkEffort =
        effort === "minimal"
            ? "low"
            : effort === "xhigh"
              ? "xhigh"
              : effort === "max"
                ? "max"
                : effort;
    return {
        effort: sdkEffort,
        thinking: { type: "adaptive", display: "summarized" },
    };
}
