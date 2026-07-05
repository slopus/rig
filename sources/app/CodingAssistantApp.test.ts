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
  it("renders the startup frame and Codex-style empty composer", () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
      version: "1.2.3",
    });

    const raw = app.render(80).join("\n");
    const rendered = stripAnsi(raw);
    const renderedLines = rendered.split("\n");
    expect(rendered).toContain(">_ Oh My Pi 1.2.3");
    expect(rendered).toContain("Model: GPT Test");
    expect(rendered).toContain("Provider: Codex");
    expect(rendered).toContain("Directory:");
    expect(rendered).toContain("Ask Oh My Pi to do anything");
    expect(renderedLines[0]?.length).toBeLessThan(80);
    expect(renderedLines[0]?.startsWith("╭")).toBe(true);
    expect(renderedLines[0]?.endsWith("╮")).toBe(true);
    expect(rendered).toContain("╰");
    expect(rendered).not.toContain("Tools:");
    expect(rendered).not.toContain("cwd:");
    expect(raw).toContain("\x1b[48;5;236m");
    expect(raw).toContain("\x1b[38;5;202m\x1b[1m›\x1b[22m\x1b[38;5;255m");
    expect(raw).toContain("\x1b[38;5;252mGPT Test");
    expect(raw).toContain("\x1b[38;5;245m/workspace");
    expect(rendered).toContain("› Ask Oh My Pi to do anything");
    expect(rendered).not.toContain("›  Ask Oh My Pi to do anything");
    expect(rendered).toContain("GPT Test");
    expect(rendered).toContain("GPT Test Off");
    expect(rendered).toContain("/workspace");
    expect(rendered).not.toContain("reasoning off");
    expect(rendered).not.toContain("/clear /abort /quit");

    app.handleInput("h");
    const typedInput = app.render(80).join("\n");
    expect(typedInput).toContain("\x1b[38;5;255m");
    expect(typedInput).toContain("\x1b[38;5;202m\x1b[1m›\x1b[22m\x1b[38;5;255m");
    expect(stripAnsi(typedInput)).toContain("› h");

    const rawLines = app.render(80);
    const strippedLines = rawLines.map(stripAnsi);
    expect(rawLines.at(-1)).toBe("");
    expect(rawLines.at(-2)).toBe("");
    const inputLineIndex = strippedLines.findIndex((line) =>
      line.includes("› h"),
    );
    const footerLineIndex = strippedLines.findIndex((line) =>
      line.startsWith("  GPT Test"),
    );
    expect(inputLineIndex).toBeGreaterThan(0);
    expect(footerLineIndex).toBe(inputLineIndex + 3);
    expect(rawLines[inputLineIndex - 1]).toContain("\x1b[48;5;236m");
    expect(rawLines[inputLineIndex]).toContain("\x1b[48;5;236m");
    expect(rawLines[inputLineIndex]).toContain("\x1b[38;5;255m");
    expect(rawLines[inputLineIndex + 1]).toContain("\x1b[48;5;236m");
    expect(rawLines[inputLineIndex + 2]).toBe("");
  });

  it("renders footer model and cwd with neutral distinct colors", () => {
    const codexModel = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const codexProvider = defineProvider({
      id: "codex",
      models: [codexModel],
      stream() {
        return streamText("unused");
      },
    });
    const codexHarness = createJustBashToolHarness();
    const codexAgent = new Agent({
      provider: codexProvider,
      modelId: codexModel.id,
      context: codexHarness.context,
      printToConsole: false,
    });
    const codexApp = new CodingAssistantApp({
      agent: codexAgent,
      cwd: codexHarness.context.fs.cwd,
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    const codexRaw = codexApp.render(80).join("\n");
    expect(codexRaw).toContain("\x1b[38;5;252mGPT Test");
    expect(codexRaw).toContain("\x1b[38;5;245m/workspace");
    expect(codexRaw).not.toContain("\x1b[36mGPT Test");

    const claudeModel = defineModel({
      id: "claude-sonnet-test",
      name: "Claude Sonnet",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const claudeProvider = defineProvider({
      id: "anthropic",
      models: [claudeModel],
      stream() {
        return streamText("unused");
      },
    });
    const claudeHarness = createJustBashToolHarness();
    const claudeAgent = new Agent({
      provider: claudeProvider,
      modelId: claudeModel.id,
      context: claudeHarness.context,
      printToConsole: false,
    });
    const claudeApp = new CodingAssistantApp({
      agent: claudeAgent,
      cwd: claudeHarness.context.fs.cwd,
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    const claudeRaw = claudeApp.render(80).join("\n");
    expect(claudeRaw).toContain("\x1b[38;5;252mClaude Sonnet");
    expect(claudeRaw).toContain("\x1b[38;5;245m/workspace");
    expect(claudeRaw).not.toContain("\x1b[38;2;215;119;87mClaude Sonnet");
  });

  it("uses the model id without vendor as the displayed model name", () => {
    const model = defineModel({
      id: "openai/gpt-5.5",
      name: "GPT-5.5",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    const rendered = stripAnsi(app.render(80).join("\n"));
    expect(rendered).toContain("Model: GPT-5.5");
    expect(rendered).toContain("GPT-5.5 Off • /workspace");
    expect(rendered).not.toContain("gpt-5-5");
    expect(rendered).not.toContain("reasoning off");
  });

  it("changes reasoning with Codex-style shortcuts", () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off", "low", "medium", "high"],
      defaultThinkingLevel: "low",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    expect(stripAnsi(app.render(80).join("\n"))).toContain("GPT Test Low");

    app.handleInput("\x1b.");
    expect(agent.snapshot().effort).toBe("medium");
    expect(stripAnsi(app.render(80).join("\n"))).toContain("GPT Test Medium");

    app.handleInput("\x1b,");
    expect(agent.snapshot().effort).toBe("low");

    app.handleInput("\x1b[1;2A");
    expect(agent.snapshot().effort).toBe("medium");

    app.handleInput("\x1b[1;2B");
    expect(agent.snapshot().effort).toBe("low");
  });

  it("replaces the composer with a two-step model and reasoning menu", () => {
    const smallModel = defineModel({
      id: "openai/gpt-small",
      name: "GPT Small",
      thinkingLevels: ["low", "medium"],
      defaultThinkingLevel: "low",
    });
    const proModel = defineModel({
      id: "openai/gpt-pro",
      name: "GPT Pro",
      thinkingLevels: ["low", "high"],
      defaultThinkingLevel: "low",
    });
    const provider = defineProvider({
      id: "codex",
      models: [smallModel, proModel],
      stream() {
        return streamText("unused");
      },
    });
    const harness = createJustBashToolHarness();
    const agent = new Agent({
      provider,
      modelId: smallModel.id,
      context: harness.context,
      printToConsole: false,
    });
    const defaultModelChanges: Array<{ effort: string; modelId: string }> = [];
    const app = new CodingAssistantApp({
      agent,
      cwd: harness.context.fs.cwd,
      onDefaultModelChange: (preference) => {
        defaultModelChanges.push(preference);
      },
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "/model");

    const modelMenuLines = app.render(80);
    const modelMenu = stripAnsi(modelMenuLines.join("\n"));
    const modelMenuTitle = modelMenuLines.find((line) =>
      stripAnsi(line).includes("Choose Model"),
    );
    const selectedModelLine = modelMenuLines.find((line) =>
      stripAnsi(line).includes("→ GPT Small"),
    );
    expect(modelMenu).toContain("Choose Model");
    expect(modelMenuTitle).toContain("\x1b[48;5;236m");
    expect(stripAnsi(modelMenuTitle ?? "")).toContain("Choose Model");
    expect(stripAnsi(modelMenuTitle ?? "")).not.toContain("›");
    expect(stripAnsi(modelMenuTitle ?? "")).not.toContain("│");
    expect(selectedModelLine).toContain("\x1b[38;5;202m");
    expect(selectedModelLine).not.toContain("\x1b[1m");
    expect(modelMenu).toContain("GPT Small");
    expect(modelMenu).toContain("GPT Pro");
    expect(modelMenu).toContain("Current model");
    expect(modelMenu).toContain("Codex model");
    expect(modelMenu).toContain("Default reasoning: Low");
    expect(modelMenu).not.toContain("Available model");
    expect(modelMenu).toContain("Use ↑/↓ to move, Enter to select, Esc to cancel.");
    expect(modelMenu).not.toContain("Ask Oh My Pi to do anything");

    app.handleInput("\x1b[B");
    app.handleInput("\r");

    const reasoningMenu = stripAnsi(app.render(80).join("\n"));
    expect(reasoningMenu).toContain("Choose Reasoning");
    expect(reasoningMenu).toContain("GPT Pro");
    expect(reasoningMenu).toContain("Low");
    expect(reasoningMenu).toContain("High");
    expect(reasoningMenu).toContain("Use light reasoning for simple coding tasks.");
    expect(reasoningMenu).toContain("Spend more time on harder changes.");
    expect(reasoningMenu).not.toContain("Ask Oh My Pi to do anything");

    app.handleInput("\x1b[B");
    app.handleInput("\r");

    const rendered = stripAnsi(app.render(80).join("\n"));
    expect(agent.model.id).toBe(proModel.id);
    expect(agent.snapshot().effort).toBe("high");
    expect(defaultModelChanges).toEqual([{ modelId: proModel.id, effort: "high" }]);
    expect(rendered).toContain("GPT Pro High");
    expect(rendered).toContain("Model changed to GPT Pro with High reasoning.");
    expect(rendered).toContain("Ask Oh My Pi to do anything");
  });

  it("opens the model menu with Alt+M", () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    app.handleInput("\x1bm");

    const rendered = stripAnsi(app.render(80).join("\n"));
    expect(rendered).toContain("Choose Model");
    expect(rendered).not.toContain("Ask Oh My Pi to do anything");
  });

  it("shows slash command autocomplete with command descriptions", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    app.focused = true;
    app.handleInput("/");
    await delay(30);

    const rawLines = app.render(80);
    const rendered = stripAnsi(rawLines.join("\n"));
    const commandLine = rawLines.find((line) => stripAnsi(line).includes("/model"));
    expect(commandLine).not.toContain("\x1b[48;5;236m");
    expect(commandLine).toContain("\x1b[38;5;202m");
    expect(commandLine).not.toContain("\x1b[1m");
    expect(rendered).toContain("/model");
    expect(rendered).toContain("Choose the model and reasoning level.");
    expect(rendered).toContain("/new");
    expect(rendered).toContain("Reset this session and start fresh.");
    expect(rendered).toContain("/exit");
    expect(rendered).toContain("Close Oh My Pi.");
    expect(rendered).toContain("/clear");
    expect(rendered).toContain("Clear the visible conversation.");
    expect(rendered).toContain("/abort");
    expect(rendered).toContain("Stop the current response.");
    expect(rendered).not.toContain("GPT Test Off •");
    expect(rendered).not.toContain("/quit");

    app.handleInput("\r");
    const modelPicker = stripAnsi(app.render(80).join("\n"));
    expect(modelPicker).toContain("Choose Model");
    expect(modelPicker).not.toContain("/model");
  });

  it("finds new session command by reset and clears agent state", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("previous answer");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "previous prompt");
    await app.waitForIdle();
    expect(agent.snapshot().messages.length).toBeGreaterThan(0);

    app.handleInput("/reset");
    const resetAutocomplete = stripAnsi(app.render(80).join("\n"));
    expect(resetAutocomplete).toContain("/new");
    expect(resetAutocomplete).toContain("Reset this session and start fresh.");
    app.handleInput("\r");

    const rendered = stripAnsi(app.render(80).join("\n"));
    expect(agent.snapshot().messages).toEqual([]);
    expect(rendered).toContain("Session reset. Started a new session.");
    expect(rendered).not.toContain("previous prompt");
    expect(rendered).not.toContain("previous answer");
  });

  it("cancels the model menu with Escape and still exits with Ctrl+C", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
      },
    });
    const harness = createJustBashToolHarness();
    const agent = new Agent({
      provider,
      modelId: model.id,
      context: harness.context,
      printToConsole: false,
    });
    const tui = fakeTui();
    const app = new CodingAssistantApp({
      agent,
      cwd: harness.context.fs.cwd,
      processManager: new NativeProxessManager(),
      tui,
    });

    app.handleInput("\x1bm");
    app.handleInput("\x1b");

    expect(stripAnsi(app.render(80).join("\n"))).toContain("Ask Oh My Pi to do anything");

    app.handleInput("\x1bm");
    app.handleInput("\x03");
    await delay(30);

    expect(tui.stop).toHaveBeenCalled();
  });

  it("renders one red session interruption notice when Escape aborts a run", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const started = deferred<void>();
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream(_model, _context, options) {
        return streamAbortAfterSignal(options?.signal, started.resolve);
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "work");
    await started.promise;
    app.handleInput("\x1b");
    await app.waitForIdle();

    const raw = app.render(80).join("\n");
    const rendered = stripAnsi(raw);
    expect(raw).toContain("\x1b[31m");
    expect(rendered.match(/Session interrupted/gu)).toHaveLength(1);
    expect(rendered).toContain("The active run was stopped.");
    expect(rendered).not.toContain("request aborted");
    expect(rendered).not.toContain("message aborted");
    expect(rendered).not.toContain("Run aborted.");
    expect(rendered).not.toContain("Stopped: aborted");
  });

  it("keeps the composer cursor steady while typing and blinks after idle", () => {
    vi.useFakeTimers();
    try {
      const model = defineModel({
        id: "openai/gpt-test",
        name: "GPT Test",
        thinkingLevels: ["off"],
        defaultThinkingLevel: "off",
      });
      const provider = defineProvider({
        id: "codex",
        models: [model],
        stream() {
          return streamText("unused");
        },
      });
      const harness = createJustBashToolHarness();
      const agent = new Agent({
        provider,
        modelId: model.id,
        context: harness.context,
        printToConsole: false,
      });
      const tui = fakeTui();
      const app = new CodingAssistantApp({
        agent,
        cwd: harness.context.fs.cwd,
        processManager: new NativeProxessManager(),
        tui,
      });

      app.focused = true;
      app.handleInput("h");
      vi.advanceTimersByTime(530);
      expect(app.render(80).join("\n")).toContain(
        "\x1b[48;5;244m\x1b[38;5;232m ",
      );

      vi.advanceTimersByTime(530);
      expect(app.render(80).join("\n")).not.toContain("\x1b[48;5;244m\x1b[38;5;232m ");
      expect(tui.requestRender).toHaveBeenCalled();
      app.focused = false;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps input background after the visible cursor", () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    app.focused = true;
    app.handleInput("ab");
    app.handleInput("\x1b[D");

    const inputLine = app.render(80).find((line) => stripAnsi(line).includes("› ab"));
    expect(inputLine).toContain(
      "\x1b[48;5;244m\x1b[38;5;232mb\x1b[48;5;236m\x1b[38;5;255m",
    );
  });

  it("renders composer padding while typing", () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    app.focused = true;
    app.handleInput("h");

    const rawLines = app.render(80);
    const renderedLines = rawLines.map(stripAnsi);
    const inputLineIndex = renderedLines.findIndex((line) =>
      line.includes("› h"),
    );
    expect(inputLineIndex).toBeGreaterThan(0);
    expect(rawLines[inputLineIndex - 1]).toContain("\x1b[48;5;236m");
    expect(rawLines[inputLineIndex]).toContain("\x1b[38;5;255m");
    expect(rawLines[inputLineIndex + 1]).toContain("\x1b[48;5;236m");
  });

  it("erases input before exiting on Ctrl+C and before process cleanup finishes", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
      },
    });
    const harness = createJustBashToolHarness();
    const agent = new Agent({
      provider,
      modelId: model.id,
      context: harness.context,
      printToConsole: false,
    });
    const tui = fakeTui();
    const processManager = new SlowKillProcessManager();
    const app = new CodingAssistantApp({
      agent,
      cwd: harness.context.fs.cwd,
      processManager,
      tui,
    });

    app.handleInput("h");
    app.handleInput("\x03");

    expect(tui.requestRender).toHaveBeenCalled();
    expect(tui.requestRender).not.toHaveBeenCalledWith(true);
    expect(stripAnsi(app.render(80).join("\n"))).not.toContain("› h");
    expect(app.render(80).join("\n")).not.toContain("\x1b[48;5;236m");
    await delay(30);

    expect(tui.stop).toHaveBeenCalled();
    expect(processManager.killAllStarted).toBe(true);
    app.handleInput("z");
    expect(stripAnsi(app.render(80).join("\n"))).not.toContain("› hz");

    processManager.finishKillAll();
  });

  it("also exits immediately on Kitty-style Ctrl+C", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("unused");
      },
    });
    const harness = createJustBashToolHarness();
    const agent = new Agent({
      provider,
      modelId: model.id,
      context: harness.context,
      printToConsole: false,
    });
    const tui = fakeTui();
    const app = new CodingAssistantApp({
      agent,
      cwd: harness.context.fs.cwd,
      processManager: new NativeProxessManager(),
      tui,
    });

    app.handleInput("\x1b[99;5u");

    await delay(30);

    expect(tui.stop).toHaveBeenCalled();
  });

  it("uses Shift-Enter for multiline input without submitting", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const contexts: Context[] = [];
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream(_model, context) {
        contexts.push(context);
        return streamText("unused");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    app.handleInput("line one");
    app.handleInput("\x1b[13;2~");
    app.handleInput("line two");

    const rendered = stripAnsi(app.render(80).join("\n"));
    expect(rendered).toContain("› line one");
    expect(rendered).toContain("  line two");
    expect(contexts).toHaveLength(0);

    app.handleInput("\r");
    await app.waitForIdle();

    expect(contexts[0]?.messages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "line one\nline two" }],
    });
  });

  it("does not render a turn separator before the first user turn", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("answer");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "/clear");
    submit(app, "first");
    await app.waitForIdle();

    const renderedLines = app.render(80).map(stripAnsi);
    const userLineIndex = renderedLines.findIndex((line) => line.includes("› first"));
    const separatorLineIndex = renderedLines.findIndex((line) =>
      line.includes("────────────────────────────────────────────────────────────────────────────────"),
    );

    expect(userLineIndex).toBeGreaterThan(0);
    expect(separatorLineIndex).toBe(-1);
  });

  it("keeps the focused empty placeholder stable without inserting padding", () => {
    vi.useFakeTimers();
    try {
      const model = defineModel({
        id: "openai/gpt-test",
        name: "GPT Test",
        thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
      });
      const provider = defineProvider({
        id: "codex",
        models: [model],
        stream() {
          return streamText("unused");
        },
      });
      const harness = createJustBashToolHarness();
      const agent = new Agent({
        provider,
        modelId: model.id,
        context: harness.context,
        printToConsole: false,
      });
      const tui = fakeTui();
      const app = new CodingAssistantApp({
        agent,
        cwd: harness.context.fs.cwd,
        processManager: new NativeProxessManager(),
        tui,
      });

      app.focused = true;
      const visibleCursor = app.render(80).join("\n");
      expect(visibleCursor).toContain("\x1b_pi:c\x07");
      expect(visibleCursor).toContain("\x1b[48;5;244m\x1b[38;5;232mA");
      expect(stripAnsi(visibleCursor)).toContain("› Ask Oh My Pi to do anything");
      expect(stripAnsi(visibleCursor)).not.toContain("›  Ask Oh My Pi to do anything");

      vi.advanceTimersByTime(530);

      const hiddenCursor = app.render(80).join("\n");
      expect(hiddenCursor).not.toContain("\x1b[48;5;244m\x1b[38;5;232mA");
      expect(stripAnsi(hiddenCursor)).toContain("› Ask Oh My Pi to do anything");
      expect(stripAnsi(hiddenCursor)).not.toContain("›  Ask Oh My Pi to do anything");
      expect(tui.requestRender).toHaveBeenCalled();
      app.focused = false;
    } finally {
      vi.useRealTimers();
    }
  });

  it("submits input to the agent and renders streamed assistant output", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
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
    app.handleInput("\r");
    await app.waitForIdle();

    const rendered = stripAnsi(app.render(80).join("\n"));
    expect(contexts[0]?.messages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "hi" }],
    });
    expect(rendered).toContain("› hi");
    expect(rendered).toContain("• hello from agent");
    const composerLines = app.render(80).filter((line) =>
      line.includes("\x1b[48;5;236m") && line.includes("\x1b[38;5;255m"),
    );
    expect(composerLines.length).toBeGreaterThanOrEqual(1);
  });

  it("renders multiline assistant output as one marked message", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return streamText("first line\nsecond line\n\nthird line");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "multiline");
    await app.waitForIdle();

    const renderedLines = app.render(80).map((line) => stripAnsi(line).trimEnd());
    const firstLineIndex = renderedLines.findIndex((line) => line === "• first line");
    const secondLineIndex = renderedLines.findIndex((line) => line === "  second line");
    const thirdLineIndex = renderedLines.findIndex((line) => line === "  third line");

    expect(firstLineIndex).toBeGreaterThan(0);
    expect(secondLineIndex).toBe(firstLineIndex + 1);
    expect(thirdLineIndex).toBe(secondLineIndex + 2);
    expect(renderedLines[secondLineIndex + 1]).toBe("");
    expect(renderedLines).not.toContain("• second line");
    expect(renderedLines).not.toContain("• third line");
  });

  it("renders tool rows with a two-line Codex-style call and one-line result", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const contexts: Context[] = [];
    let streamCalls = 0;
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream(_model, context) {
        contexts.push(context);
        streamCalls += 1;
        if (streamCalls === 1) {
          return streamMessage({
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "tool-call-1",
                name: "exec_command",
                arguments: { cmd: "printf 'line one\\nline two\\n'" },
              },
            ],
            api: "test",
            provider: "codex",
            model: "openai/gpt-test",
            usage: zeroUsage(),
            stopReason: "toolUse",
            timestamp: 1,
          });
        }

        return streamText("done");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "status");
    await app.waitForIdle();

    const raw = app.render(80).join("\n");
    const rendered = stripAnsi(raw);
    expect(raw).toContain("\x1b[38;5;202m\x1b[1mRan");
    expect(rendered).toContain("• Ran printf 'line one\\nline two\\n'");
    expect(rendered).toContain("└ line one (+1 lines)");
    const resultLines = rendered
      .split("\n")
      .filter((line) => line.trimStart().startsWith("└"));
    expect(resultLines).toHaveLength(1);
    expect(resultLines.join("\n")).not.toContain("line two");
    expect(contexts[1]?.messages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "tool-call-1",
      toolName: "exec_command",
      content: [
        {
          type: "text",
          text: expect.stringContaining("line one\nline two"),
        },
      ],
    });
  });

  it("renders a separator when the loop starts a second inference iteration", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    let streamCalls = 0;
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        streamCalls += 1;
        if (streamCalls === 1) {
          return streamMessage({
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "tool-call-1",
                name: "exec_command",
                arguments: { cmd: "printf ok" },
              },
            ],
            api: "test",
            provider: "codex",
            model: "openai/gpt-test",
            usage: zeroUsage(),
            stopReason: "toolUse",
            timestamp: 1,
          });
        }

        return streamText("after tools");
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "use tool");
    await app.waitForIdle();

    const rendered = stripAnsi(app.render(80).join("\n"));
    expect(streamCalls).toBe(2);
    expect(rendered).toContain("• Ran printf ok");
    expect(rendered).toContain("└ ok");
    expect(rendered).toContain("────────────────────────────────────────────────────────────────────────────────");
    expect(rendered).toContain("• after tools");
  });

  it("shows Working before second inference content starts", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    let streamCalls = 0;
    const gate = createBeforeTextStartStreamGate("after tools");
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        streamCalls += 1;
        if (streamCalls === 1) {
          return streamMessage({
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "tool-call-1",
                name: "exec_command",
                arguments: { cmd: "printf ok" },
              },
            ],
            api: "test",
            provider: "codex",
            model: "openai/gpt-test",
            usage: zeroUsage(),
            stopReason: "toolUse",
            timestamp: 1,
          });
        }

        return gate.stream();
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "use tool");
    await gate.started;

    const renderedDuringSecondTurn = stripAnsi(app.render(80).join("\n"));
    expect(streamCalls).toBe(2);
    expect(renderedDuringSecondTurn).toContain(
      "────────────────────────────────────────────────────────────────────────────────",
    );
    expect(renderedDuringSecondTurn).toContain("• Working");
    expect(renderedDuringSecondTurn).not.toContain("• after tools");

    gate.release();
    await app.waitForIdle();
  });

  it("shows active thinking inside the composer instead of the footer", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["high"],
      defaultThinkingLevel: "high",
    });
    let now = 10_000;
    const gate = createThinkingStreamGate("done");
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return gate.stream();
      },
    });
    const harness = createJustBashToolHarness();
    const agent = new Agent({
      provider,
      modelId: model.id,
      context: harness.context,
      effort: "high",
      printToConsole: false,
    });
    const app = new CodingAssistantApp({
      agent,
      cwd: harness.context.fs.cwd,
      now: () => now,
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "think");
    await gate.startedThinking;
    now = 75_000;

    const rawWhileThinking = app.render(80);
    const thinkingLine = rawWhileThinking.find((line) =>
      stripAnsi(line).includes("• Thinking"),
    ) ?? "";
    const renderedWhileThinking = stripAnsi(rawWhileThinking.join("\n"));
    expect(renderedWhileThinking).toContain("• Thinking (1m 5s)");
    expect(renderedWhileThinking).toContain("GPT Test High");
    expect(renderedWhileThinking).not.toContain("Idle |");
    expect(thinkingLine).toContain("\x1b[38;5;255m");
    expect(thinkingLine).toContain("\x1b[38;5;244m");
    expect(thinkingLine).toContain("\x1b[2m\x1b[38;5;245m(1m 5s)");
    expect(thinkingLine).not.toContain("\x1b[38;5;255m(");
    expect(thinkingLine).not.toContain("\x1b[38;5;244m(");

    gate.release();
    await app.waitForIdle();
  });

  it("keeps activity visible after text_start until the first text delta", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const gate = createTextStartStreamGate("done");
    const provider = defineProvider({
      id: "codex",
      models: [model],
      stream() {
        return gate.stream();
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
      processManager: new NativeProxessManager(),
      tui: fakeTui(),
    });

    submit(app, "stream");
    await gate.startedText;

    const renderedAfterTextStart = stripAnsi(app.render(80).join("\n"));
    expect(renderedAfterTextStart).toContain("• Working");
    expect(renderedAfterTextStart).not.toContain("• \n");

    gate.release();
    await app.waitForIdle();

    const renderedAfterDelta = stripAnsi(app.render(80).join("\n"));
    expect(renderedAfterDelta).toContain("• done");
    expect(renderedAfterDelta).not.toContain("• Working");
  });

  it("renders full transcript so PI TUI owns the bottom viewport and scrollback", async () => {
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
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
    expect(rendered).toContain("› first");
    expect(rendered).toContain("• answer 4");
    expect(rendered).not.toContain("────────────────────────────────────────────────────────────────────────────────");
  });
});

function createDeterministicIds(): () => string {
  let next = 0;
  return () => `app-id-${++next}`;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    process.nextTick(resolve);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
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

class SlowKillProcessManager extends NativeProxessManager {
  killAllStarted = false;
  #finishKillAll: (() => void) | undefined;

  override async killAll(
    ..._args: Parameters<NativeProxessManager["killAll"]>
  ): Promise<void> {
    this.killAllStarted = true;
    await new Promise<void>((resolve) => {
      this.#finishKillAll = resolve;
    });
  }

  finishKillAll(): void {
    this.#finishKillAll?.();
  }
}

function submit(app: CodingAssistantApp, text: string): void {
  app.handleInput(text);
  app.handleInput("\r");
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

function streamMessage(message: AssistantMessage): InferenceStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const, partial: message };
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

function streamAbortAfterSignal(
  signal: AbortSignal | undefined,
  started: () => void,
): InferenceStream {
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: "test",
    provider: "codex",
    model: "openai/gpt-test",
    usage: zeroUsage(),
    stopReason: "aborted",
    timestamp: 1,
    errorMessage: "request aborted: message aborted",
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const, partial: message };
      started();
      if (!signal?.aborted) {
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      yield {
        type: "error" as const,
        reason: "aborted" as const,
        error: message,
      };
    },
    async result() {
      return message;
    },
  };
}

function createThinkingStreamGate(text: string): {
  release: () => void;
  startedThinking: Promise<void>;
  stream: () => InferenceStream;
} {
  let release: () => void = () => {};
  let startedThinking: () => void = () => {};
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startedThinkingPromise = new Promise<void>((resolve) => {
    startedThinking = resolve;
  });

  return {
    release,
    startedThinking: startedThinkingPromise,
    stream() {
      return streamThinking(text, startedThinking, releasePromise);
    },
  };
}

function createTextStartStreamGate(text: string): {
  release: () => void;
  startedText: Promise<void>;
  stream: () => InferenceStream;
} {
  let release: () => void = () => {};
  let startedText: () => void = () => {};
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startedTextPromise = new Promise<void>((resolve) => {
    startedText = resolve;
  });

  return {
    release,
    startedText: startedTextPromise,
    stream() {
      return streamTextStart(text, startedText, releasePromise);
    },
  };
}

function createBeforeTextStartStreamGate(text: string): {
  release: () => void;
  started: Promise<void>;
  stream: () => InferenceStream;
} {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });

  return {
    release,
    started: startedPromise,
    stream() {
      started();
      return streamBeforeTextStart(text, releasePromise);
    },
  };
}

function streamThinking(
  text: string,
  startedThinking: () => void,
  releasePromise: Promise<void>,
): InferenceStream {
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
      yield { type: "thinking_start" as const, contentIndex: 0, partial: message };
      startedThinking();
      await releasePromise;
      yield { type: "text_start" as const, contentIndex: 0, partial: message };
      yield {
        type: "text_delta" as const,
        contentIndex: 0,
        delta: text,
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

function streamTextStart(
  text: string,
  startedText: () => void,
  releasePromise: Promise<void>,
): InferenceStream {
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
      startedText();
      await releasePromise;
      yield {
        type: "text_delta" as const,
        contentIndex: 0,
        delta: text,
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

function streamBeforeTextStart(
  text: string,
  releasePromise: Promise<void>,
): InferenceStream {
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
      await releasePromise;
      yield { type: "text_start" as const, contentIndex: 0, partial: message };
      yield {
        type: "text_delta" as const,
        contentIndex: 0,
        delta: text,
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
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\x1b_pi:c\x07/g, "");
}
