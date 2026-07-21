import type { AgentMessage, ToolCallBlock } from "../agent/types.js";
import type { SessionEvent } from "../protocol/index.js";
import type { Usage } from "../providers/types.js";
import type { HappySessionEnvelope, HappySessionProtocolMessage, HappyUsage } from "./types.js";

export function mapSessionEventToHappyMessages(
    event: SessionEvent,
): readonly HappySessionProtocolMessage[] {
    if (event.type === "message_submitted") {
        if (event.data.message.id.startsWith("happy:")) return [];
        return [
            createMessage({
                ev: { t: "text", text: event.data.displayText },
                id: event.data.message.id,
                role: "user",
                time: event.createdAt,
            }),
        ];
    }
    if (event.type === "run_started") {
        return [
            agentMessage(event, `${event.id}:turn-start`, event.data.runId, { t: "turn-start" }),
        ];
    }
    if (event.type === "run_finished") {
        const status = event.data.stopReason === "aborted" ? "cancelled" : "completed";
        return [
            agentMessage(event, `${event.id}:turn-end`, event.data.runId, {
                status,
                t: "turn-end",
            }),
        ];
    }
    if (event.type === "run_error") {
        return [
            agentMessage(event, `${event.id}:error`, event.data.runId, {
                t: "service",
                text: event.data.errorMessage,
            }),
            agentMessage(event, `${event.id}:turn-end`, event.data.runId, {
                status: "failed",
                t: "turn-end",
            }),
        ];
    }
    if (event.type === "abort_requested" && event.data.runId !== undefined) {
        return [
            agentMessage(event, `${event.id}:turn-end`, event.data.runId, {
                status: "cancelled",
                t: "turn-end",
            }),
        ];
    }
    if (event.type === "agent_event") return mapAgentEvent(event);
    if (event.type === "agent_message" && event.data.message.role === "agent") {
        return mapAgentMessage(event, event.data.message);
    }
    return [];
}

function mapAgentEvent(event: Extract<SessionEvent, { type: "agent_event" }>) {
    const streamed = event.data.event;
    if (streamed.type === "tool_execution_end") {
        return [
            agentMessage(event, `tool-result:${streamed.result.toolCallId}`, event.data.runId, {
                call: streamed.result.toolCallId,
                t: "tool-call-end",
            }),
        ];
    }
    if (streamed.type === "context_compacted") {
        return [
            agentMessage(event, `${event.id}:compacted`, event.data.runId, {
                t: "service",
                text: "Context compacted.",
            }),
        ];
    }
    return [];
}

function mapAgentMessage(
    event: Extract<SessionEvent, { type: "agent_message" }>,
    message: AgentMessage,
): HappySessionProtocolMessage[] {
    const output: HappySessionProtocolMessage[] = [];
    for (const [index, block] of message.blocks.entries()) {
        if (block.type === "text") {
            output.push(
                agentMessage(event, `${message.id}:text:${index}`, event.data.runId, {
                    t: "text",
                    text: block.text,
                }),
            );
        } else if (block.type === "thinking") {
            output.push(
                agentMessage(event, `${message.id}:thinking:${index}`, event.data.runId, {
                    t: "text",
                    text: block.thinking,
                    thinking: true,
                }),
            );
        } else if (block.type === "tool_call") {
            output.push(toolCallStartMessage(event, message.id, block, event.data.runId));
        } else if (block.type === "tool_result") {
            output.push(
                agentMessage(event, `tool-result:${block.toolCallId}`, event.data.runId, {
                    call: block.toolCallId,
                    t: "tool-call-end",
                }),
            );
        }
    }
    const usage = toHappyUsage(message.usage);
    if (usage !== undefined && output[0] !== undefined) output[0].content.usage = usage;
    return output;
}

function toolCallStartMessage(
    event: SessionEvent,
    messageId: string,
    toolCall: Pick<ToolCallBlock, "arguments" | "id" | "name">,
    runId: string,
): HappySessionProtocolMessage {
    const title = humanizeToolName(toolCall.name);
    return agentMessage(event, `${messageId}:tool:${toolCall.id}:start`, runId, {
        args: toRecord(toolCall.arguments),
        call: toolCall.id,
        description: `Running ${title}`,
        name: toolCall.name,
        t: "tool-call-start",
        title,
    });
}

function humanizeToolName(value: string): string {
    const spaced = value
        .replaceAll(/[_-]+/gu, " ")
        .replaceAll(/([a-z])([A-Z])/gu, "$1 $2")
        .trim();
    return spaced.length === 0
        ? "Tool"
        : spaced
              .split(/\s+/u)
              .map((part) => part[0]!.toUpperCase() + part.slice(1))
              .join(" ");
}

function toRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { value };
}

function toHappyUsage(usage: Usage | undefined): HappyUsage | undefined {
    if (usage === undefined) return undefined;
    return {
        cache_creation_input_tokens: usage.cacheWrite,
        cache_read_input_tokens: usage.cacheRead,
        input_tokens: usage.input,
        output_tokens: usage.output,
    };
}

function agentMessage(
    event: SessionEvent,
    id: string,
    turn: string,
    ev: HappySessionEnvelope["ev"],
): HappySessionProtocolMessage {
    return createMessage({ ev, id, role: "agent", time: event.createdAt, turn });
}

function createMessage(content: HappySessionEnvelope): HappySessionProtocolMessage {
    return {
        content,
        localId: `rig:${content.id}`,
        meta: { sentFrom: "rig" },
        role: "session",
    };
}
