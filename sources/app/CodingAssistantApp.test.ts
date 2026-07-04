import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { Agent } from "../agent/Agent.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { NativeProxessManager } from "../processes/index.js";
import {
  defineModel,
  defineProvider,
  type AssistantMessage,
  type Context,
  type InferenceStream,
  type Usage,
} from "../providers/types.js";
import { CodingAssistantApp } from "./CodingAssistantApp.js";

describe("CodingAssistantApp", () => {
  it("submits input to the agent and renders streamed assistant output", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
    });
    const contexts: Context[] = [];
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream(_model, context) {
        contexts.push(context);
        return streamText("hello from agent");
      },
    });
    const harness = createJustBashToolHarness();
    const agent = new Agent({
      provider,
      modelId: model.id,
      context: harness.context,
      printToConsole: false,
    });
    const app = new CodingAssistantApp({
      agent,
      cwd: harness.context.fs.cwd,
      idFactory: createDeterministicIds(),
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    app.handleInput("h");
    app.handleInput("i");
    app.handleInput("\n");
    await app.waitForIdle();

    const rendered = stripAnsi(app.render(80).join("\n"));
    expect(contexts[0]?.messages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "hi" }],
    });
    expect(rendered).toContain("You: hi");
    expect(rendered).toContain("Agent: hello from agent");
  });

  it("renders full transcript so PI TUI owns the bottom viewport and scrollback", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
    });
    const contexts: Context[] = [];
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream(_model, context) {
        contexts.push(context);
        return streamText(`answer ${contexts.length}`);
      },
    });
    const harness = createJustBashToolHarness();
    const agent = new Agent({
      provider,
      modelId: model.id,
      context: harness.context,
      printToConsole: false,
    });
    const app = new CodingAssistantApp({
      agent,
      cwd: harness.context.fs.cwd,
      idFactory: createDeterministicIds(),
      processManager: new NativeProxessManager(),
      tui: fakeTui({ rows: 8 }),
    });

    submit(app, "first");
    await app.waitForIdle();
    submit(app, "second");
    await app.waitForIdle();
    submit(app, "third");
    await app.waitForIdle();
    submit(app, "fourth");
    await app.waitForIdle();

    const lines = app.render(80);
    const rendered = stripAnsi(lines.join("\n"));
    expect(lines.length).toBeGreaterThan(8);
    expect(rendered).toContain("You: first");
    expect(rendered).toContain("Agent: answer 4");
  });
});

function createDeterministicIds(): () => string {
  let next = 0;
  return () => `app-id-${++next}`;
}

function fakeTui(options: { rows?: number; columns?: number } = {}): TUI {
  return {
    addChild: vi.fn(),
    requestRender: vi.fn(),
    setFocus: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    terminal: {
      rows: options.rows ?? 20,
      columns: options.columns ?? 80,
    },
  } as unknown as TUI;
}

function submit(app: CodingAssistantApp, text: string): void {
  app.handleInput(text);
  app.handleInput("\n");
}

function streamText(text: string): InferenceStream {
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "codex",
    model: "openai/gpt-test",
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: 1,
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const, partial: message };
      yield { type: "text_start" as const, contentIndex: 0, partial: message };
      yield {
        type: "text_delta" as const,
        contentIndex: 0,
        delta: "hello ",
        partial: message,
      };
      yield {
        type: "text_delta" as const,
        contentIndex: 0,
        delta: "from agent",
        partial: message,
      };
      yield {
        type: "text_end" as const,
        contentIndex: 0,
        content: text,
        partial: message,
      };
      yield { type: "done" as const, reason: "stop", message };
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

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
