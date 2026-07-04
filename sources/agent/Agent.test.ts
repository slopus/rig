import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { Agent } from "./Agent.js";
import { defineTool } from "./types.js";
import {
  defineModel,
  defineProvider,
  type AssistantMessage,
  type Context,
  type InferenceStream,
  type Usage,
} from "../providers/types.js";

describe("Agent", () => {
  it("queues steering and user messages, runs the loop, and prints messages", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off", "high"],
    });
    const contexts: Context[] = [];
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream(_model, context) {
        contexts.push(context);
        return streamFor({
          role: "assistant",
          content: [{ type: "text", text: "agent-done" }],
          api: "test",
          provider: "codex",
          model: "openai/gpt-test",
          usage: zeroUsage(),
          stopReason: "stop",
          timestamp: 1,
        });
      },
    });
    const logs: unknown[][] = [];
    const observedEvents: string[] = [];
    const observedMessages: string[] = [];
    const harness = createJustBashToolHarness();
    const agent = new Agent({
      provider,
      modelId: "openai/gpt-test",
      context: harness.context,
      instructions: "Base instructions.",
      idFactory: createDeterministicIds(),
      now: () => 1,
      console: {
        log(...data) {
          logs.push(data);
        },
      },
      onEvent(event) {
        observedEvents.push(event.type);
      },
      onMessage(message) {
        observedMessages.push(message.id);
      },
    });

    const steering = agent.addSteering("Keep answers short.");
    const user = agent.enqueueUserMessage("Say done.");
    const queuedIds = agent.queue.map((entry) => entry.id);

    expect(agent.id).toBe("id-1");
    expect(steering.id).toBe("id-2");
    expect(user.id).toBe("id-4");
    expect(queuedIds).toEqual(["id-3", "id-5"]);

    const result = await agent.run();

    expect(result.runId).toBe("id-6");
    expect(result.stopReason).toBe("stop");
    expect(agent.status).toBe("idle");
    expect(agent.queue).toEqual([]);
    expect(agent.messages.map((message) => message.id)).toEqual([
      "id-2",
      "id-4",
      "id-7",
    ]);
    expect(contexts[0]?.systemPrompt).toBe(
      "Base instructions.\n\nKeep answers short.",
    );
    expect(logs.map((entry) => entry[0])).toEqual([
      "[system:id-2] Keep answers short.",
      "[user:id-4] Say done.",
      "[agent:id-7] agent-done",
    ]);
    expect(observedEvents).toEqual(["start", "done"]);
    expect(observedMessages).toEqual(["id-7"]);
  });

  it("selects codex tools for GPT models and allows explicit tool overrides", () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamFor({
          role: "assistant",
          content: [],
          api: "test",
          provider: "codex",
          model: "openai/gpt-test",
          usage: zeroUsage(),
          stopReason: "stop",
          timestamp: 1,
        });
      },
    });
    const harness = createJustBashToolHarness();

    const defaultAgent = new Agent({
      provider,
      modelId: "openai/gpt-test",
      context: harness.context,
      printToConsole: false,
    });
    expect(defaultAgent.tools.map((tool) => tool.name)).toEqual([
      "exec_command",
      "write_stdin",
      "apply_patch",
      "view_image",
    ]);

    const noopTool = defineTool({
      name: "noop",
      label: "Noop",
      description: "Does nothing.",
      arguments: Type.Object({}),
      returnType: Type.Object({ ok: Type.Boolean() }),
      execute: () => ({ ok: true }),
      toLLM: () => [{ type: "text", text: "ok" }],
      locks: [],
    });
    const overrideAgent = new Agent({
      provider,
      modelId: "openai/gpt-test",
      context: harness.context,
      tools: [noopTool],
      printToConsole: false,
    });

    expect(overrideAgent.tools.map((tool) => tool.name)).toEqual(["noop"]);
  });
});

function createDeterministicIds(): () => string {
  let next = 0;
  return () => `id-${++next}`;
}

function streamFor(message: AssistantMessage): InferenceStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "start" as const,
        partial: message,
      };
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        yield {
          type: "error" as const,
          reason: message.stopReason,
          error: message,
        };
        return;
      }
      yield {
        type: "done" as const,
        reason: message.stopReason,
        message,
      };
    },
    async result() {
      return message;
    },
  };
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}
