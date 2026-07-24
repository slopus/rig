import { randomUUID } from "node:crypto";

import {
    query as defaultClaudeSdkQuery,
    type Options as ClaudeSdkOptions,
} from "@anthropic-ai/claude-agent-sdk";

import type {
    ClaudeAuxiliaryQueryRequest,
    ClaudeAuxiliaryQueryResponse,
} from "@/vendors/claude/ClaudeAuxiliaryQuery.js";
import type { ClaudeSessionOptions } from "@/vendors/claude/ClaudeSession.js";
import { toClaudeSdkOptions } from "@/vendors/claude/impl/toClaudeSdkOptions.js";

export async function runClaudeAuxiliaryQuery(
    options: Pick<
        ClaudeSessionOptions,
        "credential" | "cwd" | "env" | "pathToClaudeCodeExecutable" | "query"
    > & {
        model: string;
        request: ClaudeAuxiliaryQueryRequest;
    },
): Promise<ClaudeAuxiliaryQueryResponse> {
    const sdkOptions = toClaudeSdkOptions({
        ...(options.request.signal === undefined ? {} : { abort: options.request.signal }),
        context: { instructions: "", messages: [] },
        credential: options.credential,
        cwd: options.cwd,
        env: options.env ?? process.env,
        model: options.model,
        ...(options.pathToClaudeCodeExecutable === undefined
            ? {}
            : { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }),
        sessionId: randomUUID(),
        skills: [],
        systemPrompt: options.request.systemPrompt,
        tools: [],
    });
    configureBuiltinTools(sdkOptions, options.request.tools ?? []);
    const stream = (options.query ?? defaultClaudeSdkQuery)({
        prompt: options.request.prompt,
        options: sdkOptions,
    });
    const content: unknown[] = [];
    try {
        for await (const message of stream) {
            if (message.type === "assistant") {
                if (message.error !== undefined) {
                    throw new Error(`Claude auxiliary inference failed: ${message.error}`);
                }
                content.push(...message.message.content);
            }
            if (message.type === "result" && (message.subtype !== "success" || message.is_error)) {
                const detail =
                    message.subtype === "success"
                        ? message.result
                        : message.errors.join("\n").trim();
                throw new Error(detail || "Claude auxiliary inference failed.");
            }
        }
        return { content };
    } finally {
        stream.close();
    }
}

function configureBuiltinTools(options: ClaudeSdkOptions, tools: readonly "WebSearch"[]): void {
    options.allowedTools = [...tools];
    options.tools = [...tools];
}
