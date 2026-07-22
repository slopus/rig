import { Type } from "@sinclair/typebox";

import type { AgentToolAdaptation, AgentToolAdapter } from "../agent/AgentToolAdapter.js";
import { defineTool, type AnyDefinedTool } from "../agent/types.js";
import { readCodexBedrockDeferredTools } from "./readCodexBedrockDeferredTools.js";
import { readCodexBedrockTools } from "./readCodexBedrockTools.js";
import { toOpenAIResponseTools } from "../providers/toOpenAIResponseTools.js";

const collaborationNames = new Set([
    "spawn_agent",
    "followup_task",
    "send_message",
    "wait_agent",
    "list_agents",
    "interrupt_agent",
    "resume_agent",
    "workflow",
    "wait_for_workflow",
    "workflow_status",
    "stop_workflow",
]);

const inputItems = Type.Optional(
    Type.Array(
        Type.Object(
            {
                audio_url: Type.Optional(Type.String()),
                image_url: Type.Optional(Type.String()),
                name: Type.Optional(Type.String()),
                path: Type.Optional(Type.String()),
                text: Type.Optional(Type.String()),
                type: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
        ),
    ),
);

export class CodexBedrockToolSearchAdapter implements AgentToolAdapter {
    adapt(tools: readonly AnyDefinedTool[]): AgentToolAdaptation {
        const directByName = new Map(
            tools
                .filter((tool) => !collaborationNames.has(tool.name))
                .map((tool) => [tool.name, tool]),
        );
        const officialTools = readCodexBedrockTools();
        const direct = officialTools.flatMap((providerTool) => {
            if (providerTool.kind === "tool_search") return [];
            const tool = "name" in providerTool ? directByName.get(providerTool.name) : undefined;
            return tool === undefined ? [] : [{ ...tool, providerTool }];
        });
        const collaboration = new Map(tools.map((tool) => [tool.name, tool]));
        const wrappers = createWrappers(collaboration);
        if (wrappers.length === 0) return { exposedTools: direct, nestedTools: [] };
        return {
            exposedTools: [...direct, createToolSearchTool()],
            nestedTools: wrappers,
        };
    }
}

function createToolSearchTool(): AnyDefinedTool {
    const deferred = readCodexBedrockDeferredTools();
    const providerTool = readCodexBedrockTools().find((tool) => tool.kind === "tool_search");
    if (providerTool?.kind !== "tool_search") {
        throw new Error("Official Codex Bedrock tool_search definition is unavailable.");
    }
    return defineTool({
        name: "tool_search",
        label: "tool_search",
        description: deferred.toolSearch.description,
        providerTool,
        arguments: Type.Object(
            {
                limit: Type.Optional(Type.Number()),
                query: Type.String(),
            },
            { additionalProperties: false },
        ),
        returnType: Type.Any(),
        shouldReviewInAutoMode: () => false,
        execute: () => ({ tools: toOpenAIResponseTools([deferred.namespace]) }),
        toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
        toUI: () => "Loaded subagent tools.",
        locks: [],
    });
}

function createWrappers(tools: ReadonlyMap<string, AnyDefinedTool>): AnyDefinedTool[] {
    const wrappers: AnyDefinedTool[] = [];
    const spawn = tools.get("spawn_agent");
    if (spawn !== undefined) {
        wrappers.push({
            ...spawn,
            description: officialDescription("spawn_agent"),
            arguments: Type.Object(
                {
                    fork_context: Type.Optional(Type.Boolean()),
                    items: inputItems,
                    message: Type.Optional(Type.String()),
                    model: Type.Optional(Type.String()),
                    reasoning_effort: Type.Optional(Type.String()),
                    service_tier: Type.Optional(Type.String()),
                },
                { additionalProperties: false },
            ),
            codeMode: { namespace: "multi_agent_v1" },
            execute: (args, context, execution) => {
                const value = args as {
                    fork_context?: boolean;
                    items?: readonly { text?: string }[];
                    message?: string;
                    model?: string;
                    reasoning_effort?: string;
                    service_tier?: string;
                };
                if (value.service_tier !== undefined && value.service_tier !== "fast") {
                    throw new Error(`Unsupported service tier '${value.service_tier}'.`);
                }
                return spawn.execute(
                    {
                        context: value.fork_context === true ? "parent" : "task",
                        task_name: `subagent_${execution.toolCallId?.slice(-8) ?? "task"}`,
                        message: messageText(value.message, value.items),
                        ...(value.model === undefined
                            ? {}
                            : {
                                  model: value.model.startsWith("openai.")
                                      ? `openai/${value.model.slice("openai.".length)}`
                                      : value.model,
                              }),
                        ...(value.reasoning_effort === undefined
                            ? {}
                            : { effort: value.reasoning_effort }),
                        ...(value.service_tier === undefined
                            ? {}
                            : { service_tier: value.service_tier }),
                    } as never,
                    context,
                    execution,
                );
            },
        });
    }
    const interrupt = tools.get("interrupt_agent");
    if (interrupt !== undefined) {
        wrappers.push({
            ...interrupt,
            name: "close_agent",
            label: "close_agent",
            description: officialDescription("close_agent"),
            arguments: Type.Object({ target: Type.String() }, { additionalProperties: false }),
            codeMode: { namespace: "multi_agent_v1" },
        });
    }
    const resume = tools.get("resume_agent");
    if (resume !== undefined) {
        wrappers.push({
            ...resume,
            description: officialDescription("resume_agent"),
            arguments: Type.Object({ id: Type.String() }, { additionalProperties: false }),
            codeMode: { namespace: "multi_agent_v1" },
            execute: ({ id }, context, execution) => {
                const retained = context.subagents
                    ?.list()
                    .find(
                        (agent) =>
                            agent.sessionId === id || agent.path === id || agent.taskName === id,
                    );
                if (retained !== undefined && retained.status !== "suspended") return retained;
                return resume.execute({ target: id } as never, context, execution);
            },
        });
    }
    const wait = tools.get("wait_agent");
    if (wait !== undefined) {
        wrappers.push({
            ...wait,
            description: officialDescription("wait_agent"),
            arguments: Type.Object(
                { targets: Type.Array(Type.String()), timeout_ms: Type.Optional(Type.Number()) },
                { additionalProperties: false },
            ),
            codeMode: { namespace: "multi_agent_v1" },
            execute: async ({ targets, timeout_ms }, context, execution) => {
                const result = (await wait.execute(
                    { timeout_ms } as never,
                    context,
                    execution,
                )) as { agents: readonly { path: string; sessionId: string; taskName: string }[] };
                const requested = new Set(targets);
                return {
                    ...result,
                    agents: result.agents.filter(
                        (agent) =>
                            requested.has(agent.sessionId) ||
                            requested.has(agent.path) ||
                            requested.has(agent.taskName),
                    ),
                };
            },
        });
    }
    const followup = tools.get("followup_task");
    if (followup !== undefined) {
        wrappers.push({
            ...followup,
            name: "send_input",
            label: "send_input",
            description: officialDescription("send_input"),
            arguments: Type.Object(
                {
                    interrupt: Type.Optional(Type.Boolean()),
                    items: inputItems,
                    message: Type.Optional(Type.String()),
                    target: Type.String(),
                },
                { additionalProperties: false },
            ),
            codeMode: { namespace: "multi_agent_v1" },
            execute: async (args, context, execution) => {
                const value = args as {
                    interrupt?: boolean;
                    items?: readonly { text?: string }[];
                    message?: string;
                    target: string;
                };
                if (value.interrupt === true) {
                    const interrupt = tools.get("interrupt_agent");
                    await interrupt?.execute({ target: value.target } as never, context, execution);
                }
                return followup.execute(
                    {
                        target: value.target,
                        message: messageText(value.message, value.items),
                    } as never,
                    context,
                    execution,
                );
            },
        });
    }
    return wrappers;
}

function officialDescription(name: string): string {
    const namespace = readCodexBedrockDeferredTools().namespace;
    return namespace.tools.find((tool) => tool.name === name)?.description ?? name;
}

function messageText(message: string | undefined, items: readonly { text?: string }[] | undefined) {
    if (message !== undefined) return message;
    return items?.flatMap((item) => (item.text === undefined ? [] : [item.text])).join("\n") ?? "";
}
