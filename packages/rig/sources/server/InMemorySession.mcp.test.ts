import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { Agent, createNodeAgentContext } from "../agent/index.js";
import { defineTool } from "../agent/types.js";
import type { CodingAssistantRuntime } from "../runtime/CodingAssistantRuntime.js";
import type { CreateCodingAssistantAgentOptions } from "../runtime/createCodingAssistantAgent.js";
import type { McpToolProvider } from "../mcp/index.js";
import { NativeProcessManager } from "../processes/index.js";
import { createEventIdFactory, type ModelCatalog } from "../protocol/index.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type InferenceStream,
} from "@slopus/rig-execution";
import { InMemorySession } from "./InMemorySession.js";

describe("InMemorySession MCP permissions", () => {
    it("loads MCP tools in Auto and removes them on downgrade", async () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/mcp-permissions",
            name: "MCP permissions",
            thinkingLevels: ["off"],
        });
        const toolCatalogs: string[][] = [];
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, context, options) {
                if (!options?.sessionId?.endsWith(":title")) {
                    toolCatalogs.push(context.tools?.map((tool) => tool.name) ?? []);
                }
                return responseStream();
            },
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: provider.id,
            models: [model],
            providers: [{ providerId: provider.id, models: [model] }],
        };
        const mcpTool = defineTool({
            name: "mcp__trusted__change_state",
            label: "Change state",
            description: "A test MCP tool.",
            arguments: Type.Object({}),
            returnType: Type.Unknown(),
            describeAutoPermissionAction: () =>
                "changing external state. Access: the MCP server can perform actions outside Rig’s filesystem sandbox",
            shouldReviewInAutoMode: () => true,
            execute: () => undefined,
            toLLM: () => [],
            toUI: () => "changed",
            locks: [],
        });
        const release = vi.fn(async () => undefined);
        const load = vi.fn<McpToolProvider["load"]>(async (_cwd, permissionMode) =>
            permissionMode === "auto" || permissionMode === "full_access"
                ? {
                      release,
                      servers: [{ name: "trusted", status: "connected", toolCount: 1 }],
                      tools: [mcpTool],
                  }
                : {
                      servers: [
                          {
                              errorMessage: "MCP servers require Full access.",
                              name: "trusted",
                              status: "blocked",
                              toolCount: 0,
                          },
                      ],
                      tools: [],
                  },
        );
        const mcpToolProvider: McpToolProvider = { close: async () => undefined, load };
        let runtime: CodingAssistantRuntime | undefined;
        const session = new InMemorySession({
            createEventId: createEventIdFactory(),
            createRuntime(options) {
                runtime = createRuntime(options, provider);
                return runtime;
            },
            mcpToolProvider,
            modelCatalog: catalog,
            request: {
                cwd: "/tmp/rig-mcp-permission-session",
                modelId: model.id,
                permissionMode: "read_only",
                providerId: provider.id,
            },
        });

        const restrictedRun = session.submit({ text: "Restricted turn." });
        await expect(session.waitForRun(restrictedRun.runId)).resolves.toEqual({
            status: "completed",
        });
        expect(toolCatalogs.at(-1)).not.toContain(mcpTool.name);
        expect(session.snapshot().mcpServers).toEqual([
            expect.objectContaining({ name: "trusted", status: "blocked" }),
        ]);

        await session.changePermissionMode({ permissionMode: "auto" });
        expect(runtime?.agent.tools.map((tool) => tool.name)).not.toContain(mcpTool.name);
        const autoRun = session.submit({ text: "Auto turn." });
        await expect(session.waitForRun(autoRun.runId)).resolves.toEqual({
            status: "completed",
        });
        expect(toolCatalogs.at(-1)).toContain(mcpTool.name);
        expect(session.snapshot().mcpServers).toEqual([
            expect.objectContaining({ name: "trusted", status: "connected" }),
        ]);

        await session.changePermissionMode({ permissionMode: "workspace_write" });
        expect(release).toHaveBeenCalledOnce();
        expect(runtime?.agent.tools.map((tool) => tool.name)).not.toContain(mcpTool.name);
        expect(session.snapshot().mcpServers).toEqual([
            expect.objectContaining({ name: "trusted", status: "blocked" }),
        ]);
        const downgradedRun = session.submit({ text: "Downgraded turn." });
        await expect(session.waitForRun(downgradedRun.runId)).resolves.toEqual({
            status: "completed",
        });
        expect(toolCatalogs.at(-1)).not.toContain(mcpTool.name);
        expect(load.mock.calls.map((call) => call[1])).toEqual([
            "read_only",
            "auto",
            "workspace_write",
        ]);
    });
});

function createRuntime(
    options: CreateCodingAssistantAgentOptions,
    provider: ReturnType<typeof defineProvider>,
): CodingAssistantRuntime {
    const processManager = new NativeProcessManager();
    const context = createNodeAgentContext({
        cwd: options.cwd,
        ...(options.permissionMode === undefined ? {} : { permissionMode: options.permissionMode }),
        processManager,
    });
    return {
        agent: new Agent({
            context,
            modelId: options.modelId ?? provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: [],
        }),
        context,
        cwd: options.cwd,
        processManager,
        executor: provider,
    };
}

function responseStream(): InferenceStream {
    const message: AssistantMessage = {
        api: "test",
        content: [{ text: "Done.", type: "text" }],
        model: "test/mcp-permissions",
        provider: "test",
        role: "assistant",
        stopReason: "stop",
        timestamp: 1,
        usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 0,
            output: 0,
            totalTokens: 0,
        },
    };
    return {
        async *[Symbol.asyncIterator]() {
            yield { partial: message, type: "start" as const };
            yield { message, reason: "stop" as const, type: "done" as const };
        },
        async result() {
            return message;
        },
    };
}
