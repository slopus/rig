import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { Agent } from "../agent/Agent.js";
import type { ProtocolHttpClient } from "../client/ProtocolHttpClient.js";
import { RemoteAgent } from "../client/RemoteAgent.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { validJpeg32Base64, validPng32Base64 } from "../tools/testing/validImageFixtures.js";
import { NativeProxessManager } from "../processes/index.js";
import { createPermissionContext } from "../permissions/index.js";
import type { ModelCatalog, ProtocolSession, SessionEvent } from "../protocol/index.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type Context,
    type InferenceStream,
    type Usage,
} from "../providers/types.js";
import { CodingAssistantApp } from "./CodingAssistantApp.js";
import { createSerialTaskQueue } from "./createSerialTaskQueue.js";
import { DEFAULT_TERMINAL_THEME } from "./defaultTerminalTheme.js";
import { stripAnsi } from "./testing/stripAnsi.js";

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
        const onUserActivity = vi.fn();
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            onUserActivity,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
            version: "1.2.3",
        });

        const raw = app.render(80).join("\n");
        const rendered = stripAnsi(raw);
        const renderedLines = rendered.split("\n");
        expect(rendered).toContain("  ██████╗ ██╗ ██████╗    ██╗   ██████╗    ██████╗  ");
        expect(rendered).toContain("  ╚═╝  ╚═╝╚═╝ ╚═════╝    ╚═╝╚═╝╚══════╝╚═╝╚═════╝  ");
        expect(rendered).not.toContain("Agentic coding CLI");
        expect(rendered).not.toContain("private local daemon");
        expect(rendered).not.toContain("Model: GPT Test");
        expect(rendered).not.toContain("Provider: Codex");
        expect(rendered).not.toContain("Directory:");
        expect(rendered).toContain("Ask Rig to do anything");
        expect(renderedLines[0]).toBe("");
        expect(renderedLines[1]?.length).toBeLessThan(80);
        expect(renderedLines[1]).toBe("  ██████╗ ██╗ ██████╗    ██╗   ██████╗    ██████╗  ");
        expect(rendered).not.toContain(">_ Rig");
        expect(rendered).not.toContain("Tools:");
        expect(rendered).not.toContain("cwd:");
        expect(raw).toContain("\x1b[48;5;235m");
        expect(raw).not.toContain("\x1b[48;5;236m");
        expect(raw).toContain("\x1b[38;5;202m\x1b[1m›\x1b[22m\x1b[39m");
        expect(raw).toContain("\x1b[33mgpt-test off");
        expect(raw).toContain("\x1b[32m/workspace");
        expect(rendered).toContain("› Ask Rig to do anything");
        expect(rendered).not.toContain("›  Ask Rig to do anything");
        expect(rendered).toContain("gpt-test off");
        expect(rendered).toContain("/workspace");
        expect(rendered).toContain("main [default]");
        expect(rendered).toContain("full access");
        expect(rendered).toContain("gpt-test off · /workspace · main [default] · full access");
        expect(rendered).not.toContain("full_access");
        expect(rendered).not.toContain("reasoning off");
        expect(rendered).not.toContain("/clear /abort /quit");

        app.handleInput("h");
        expect(onUserActivity).toHaveBeenCalledOnce();
        const typedInput = app.render(80).join("\n");
        expect(typedInput).toContain("\x1b[39m");
        expect(typedInput).toContain("\x1b[38;5;202m\x1b[1m›\x1b[22m\x1b[39m");
        expect(stripAnsi(typedInput)).toContain("› h");

        const rawLines = app.render(80);
        const strippedLines = rawLines.map(stripAnsi);
        expect(rawLines.at(-1)).toBe("");
        expect(rawLines.at(-2)).toContain("gpt-test off");
        const inputLineIndex = strippedLines.findIndex((line) => line.includes("› h"));
        const footerLineIndex = strippedLines.findIndex((line) => line.startsWith("  gpt-test"));
        expect(inputLineIndex).toBeGreaterThan(0);
        expect(footerLineIndex).toBe(inputLineIndex + 2);
        expect(rawLines[inputLineIndex - 1]).toContain("\x1b[48;5;235m");
        expect(rawLines[inputLineIndex]).toContain("\x1b[48;5;235m");
        expect(rawLines[inputLineIndex]).toContain("\x1b[39m");
        expect(rawLines[inputLineIndex + 1]).toContain("\x1b[48;5;235m");
        expect(rawLines[inputLineIndex + 2]).toContain("gpt-test off");
    });

    it("promotes session-backed steering from pending preview only when applied", () => {
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
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            sessionBacked: true,
            tui: fakeTui(),
        });
        const message = {
            blocks: [{ text: "Pending direction", type: "text" as const }],
            id: "steer-1",
            role: "user" as const,
        };

        app.applySessionEvent({
            createdAt: 1,
            data: {
                delivery: "steer",
                displayText: "Pending direction",
                message,
                runId: "run-1",
            },
            id: "event-submitted",
            sessionId: "session-1",
            type: "message_submitted",
        });
        const pending = stripAnsi(app.render(100).join("\n"));
        expect(pending).toContain("Messages to be submitted after next tool call");
        expect(pending).toContain("└ Pending direction");
        expect(pending).not.toContain("› Pending direction");

        app.applySessionEvent({
            createdAt: 2,
            data: { messageIds: [message.id], runId: "run-1" },
            id: "event-applied",
            sessionId: "session-1",
            type: "steering_applied",
        });
        const applied = stripAnsi(app.render(100).join("\n"));
        expect(applied).not.toContain("Messages to be submitted after next tool call");
        expect(applied).toContain("› Pending direction");
    });

    it("uses pending-aware abort without stopping the local run on Escape", async () => {
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
        const abort = vi.fn(async () => ({ aborted: true, continued: true }));
        const agent = Object.assign(
            new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            { abort },
        );
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            sessionBacked: true,
            tui: fakeTui(),
        });
        const message = {
            blocks: [{ text: "Pending direction", type: "text" as const }],
            id: "steer-1",
            role: "user" as const,
        };
        app.applySessionEvent({
            createdAt: 1,
            data: { runId: "run-1" },
            id: "event-started",
            sessionId: "session-1",
            type: "run_started",
        });
        app.applySessionEvent({
            createdAt: 2,
            data: {
                delivery: "steer",
                displayText: "Pending direction",
                message,
                runId: "run-1",
            },
            id: "event-submitted",
            sessionId: "session-1",
            type: "message_submitted",
        });

        app.handleInput("\x1b");
        await vi.waitFor(() =>
            expect(abort).toHaveBeenCalledWith({ continuePendingSteering: true }),
        );

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("esc to interrupt");
        expect(rendered).not.toContain("Session interrupted");
    });

    it("clears a draft on double Escape and retrieves it with Up", () => {
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
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            now: () => 100,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        app.handleInput("Recover this draft");
        app.handleInput("\x1b");
        expect(stripAnsi(app.render(100).join("\n"))).toContain("› Recover this draft");
        app.handleInput("\x1b");
        expect(stripAnsi(app.render(100).join("\n"))).toContain("› Ask Rig to do anything");
        app.handleInput("\x1b[A");
        expect(stripAnsi(app.render(100).join("\n"))).toContain("› Recover this draft");
    });

    it("uses the idle abort command to stop session background processes", async () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return streamText("unused");
            },
        });
        const harness = createJustBashToolHarness();
        const abort = vi.fn(async () => ({ aborted: false, stoppedProcesses: 1 }));
        const agent = Object.assign(
            new Agent({
                context: harness.context,
                modelId: model.id,
                printToConsole: false,
                provider,
            }),
            { abort },
        );
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            sessionBacked: true,
            tui: fakeTui(),
        });

        submit(app, "/abort");

        await vi.waitFor(() => expect(abort).toHaveBeenCalledOnce());
        await vi.waitFor(() =>
            expect(stripAnsi(app.render(80).join("\n"))).toContain("Stopped 1 background process."),
        );
    });

    it("repaints retained input and the composer when the terminal theme changes", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream: () => streamText("Theme response."),
        });
        const harness = createJustBashToolHarness();
        const tui = fakeTui();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            theme: DEFAULT_TERMINAL_THEME,
            tui,
        });

        submit(app, "Change the palette.");
        await app.waitForIdle();
        expect(app.render(80).join("\n")).toContain("\x1b[48;5;235m");
        vi.mocked(tui.requestRender).mockClear();

        app.setTheme({
            ...DEFAULT_TERMINAL_THEME,
            inputBackground: "\x1b[48;5;254m",
            isLight: true,
        });

        const updated = app.render(80).join("\n");
        expect(updated).toContain("Change the palette.");
        expect(updated).toContain("\x1b[48;5;254m");
        expect(updated).not.toContain("\x1b[48;5;235m");
        expect(tui.requestRender).toHaveBeenCalledWith(true);
    });

    it("opens Codex-style backtracking on Escape and restores the selected prompt", async () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return streamText("unused");
            },
        });
        const harness = createJustBashToolHarness();
        const first = {
            blocks: [{ text: "First prompt", type: "text" as const }],
            id: "user-1",
            role: "user" as const,
        };
        const second = {
            blocks: [{ text: "Try this again", type: "text" as const }],
            id: "user-2",
            role: "user" as const,
        };
        const agent = Object.assign(
            new Agent({
                context: harness.context,
                modelId: model.id,
                printToConsole: false,
                provider,
            }),
            { rewind: vi.fn(async () => second) },
        );
        const submitted = (
            message: typeof first | typeof second,
            eventId: string,
        ): SessionEvent => ({
            createdAt: 1,
            data: {
                displayText: message.blocks[0]?.text ?? "",
                message,
                runId: `run-${eventId}`,
            },
            id: eventId,
            sessionId: "session-1",
            type: "message_submitted",
        });
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            initialSessionEvents: [submitted(first, "event-1"), submitted(second, "event-2")],
            processManager: new NativeProxessManager(),
            sessionBacked: true,
            tui: fakeTui(),
        });

        app.handleInput("\x1b");
        expect(stripAnsi(app.render(100).join("\n"))).toContain("Rewind conversation");
        app.handleInput("\r");

        await vi.waitFor(() => expect(agent.rewind).toHaveBeenCalledWith("user-2"));
        await vi.waitFor(() =>
            expect(stripAnsi(app.render(100).join("\n"))).toContain("› Try this again"),
        );
    });

    it("renders the lower-case Codex footer with distinct model and cwd colors", () => {
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
        expect(codexRaw).toContain("\x1b[33mgpt-test off");
        expect(codexRaw).toContain("\x1b[32m/workspace");
        expect(stripAnsi(codexRaw)).toContain(
            "gpt-test off · /workspace · main [default] · full access",
        );

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
        expect(claudeRaw).toContain("\x1b[33mclaude-sonnet-test off");
        expect(claudeRaw).toContain("\x1b[32m/workspace");
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
            showReasoning: true,
            tui: fakeTui(),
        });

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered).not.toContain("Model: GPT-5.5");
        expect(rendered).toContain("gpt-5.5 off · /workspace");
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
            serviceTiers: ["fast"],
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
            serviceTier: "fast",
        });
        const defaultModelChanges: Array<{
            effort: string;
            modelId: string;
            providerId: string;
            serviceTier: "fast" | null;
        }> = [];
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            onDefaultModelChange: (preference) => {
                defaultModelChanges.push(preference);
            },
            processManager: new NativeProxessManager(),
            showReasoning: true,
            tui: fakeTui(),
        });

        expect(stripAnsi(app.render(80).join("\n"))).toContain("gpt-test low");

        app.handleInput("\x1b.");
        expect(agent.snapshot().effort).toBe("medium");
        expect(stripAnsi(app.render(80).join("\n"))).toContain("gpt-test medium");

        app.handleInput("\x1b,");
        expect(agent.snapshot().effort).toBe("low");

        app.handleInput("\x1b[1;2A");
        expect(agent.snapshot().effort).toBe("medium");

        app.handleInput("\x1b[1;2B");
        expect(agent.snapshot().effort).toBe("low");
        expect(defaultModelChanges).toHaveLength(4);
        expect(defaultModelChanges.at(-1)).toEqual({
            effort: "low",
            modelId: model.id,
            providerId: "codex",
            serviceTier: "fast",
        });
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
            serviceTiers: ["fast"],
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
            serviceTier: "fast",
        });
        const defaultModelChanges: Array<{
            effort: string;
            modelId: string;
            providerId: string;
            serviceTier: "fast" | null;
        }> = [];
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
        expect(modelMenuTitle).toContain("\x1b[48;5;235m");
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
        expect(modelMenu).not.toContain("Ask Rig to do anything");

        app.handleInput("\x1b[B");
        app.handleInput("\r");

        const reasoningMenu = stripAnsi(app.render(80).join("\n"));
        expect(reasoningMenu).toContain("Choose Reasoning");
        expect(reasoningMenu).toContain("GPT Pro");
        expect(reasoningMenu).toContain("Low");
        expect(reasoningMenu).toContain("High");
        expect(reasoningMenu).toContain("Use light reasoning for simple coding tasks.");
        expect(reasoningMenu).toContain("Spend more time on harder changes.");
        expect(reasoningMenu).not.toContain("Ask Rig to do anything");

        app.handleInput("\x1b[B");
        app.handleInput("\r");

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(agent.model.id).toBe(proModel.id);
        expect(agent.snapshot().effort).toBe("high");
        expect(defaultModelChanges).toEqual([
            {
                modelId: proModel.id,
                providerId: "codex",
                effort: "high",
                serviceTier: "fast",
            },
        ]);
        expect(rendered).toContain("gpt-pro high");
        expect(rendered).toContain("Model changed to GPT Pro with High reasoning.");
        expect(rendered).toContain("Ask Rig to do anything");
    });

    it("shows Bedrock-only models and sends their provider from the TUI picker", async () => {
        const gpt = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const kimi = defineModel({
            id: "moonshot/kimi-test",
            name: "Kimi Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const catalog: ModelCatalog = {
            defaultModelId: gpt.id,
            defaultProviderId: "codex",
            models: [gpt, kimi],
            providers: [
                { providerId: "codex", models: [gpt] },
                { providerId: "bedrock", models: [gpt, kimi] },
            ],
        };
        const snapshot = {
            id: "agent-1",
            messages: [],
            modelId: gpt.id,
            providerId: "codex",
            queue: [],
            status: "idle" as const,
            tools: [],
        };
        const session: ProtocolSession = {
            agent: {
                depth: 0,
                rootSessionId: "session-1",
                type: "primary",
            },
            id: "session-1",
            agentId: snapshot.id,
            cwd: "/workspace",
            modelId: gpt.id,
            modelLocked: false,
            models: [gpt],
            providerId: "codex",
            permissionMode: "workspace_write",
            mcpServers: [],
            pendingUserInputs: [],
            tasks: [],
            snapshot,
            status: "idle",
            titleStatus: "idle",
        };
        const bedrockSession: ProtocolSession = {
            ...session,
            modelId: kimi.id,
            models: [gpt, kimi],
            providerId: "bedrock",
            snapshot: {
                ...snapshot,
                modelId: kimi.id,
                providerId: "bedrock",
            },
        };
        const changeModel = vi.fn(async () => ({ session: bedrockSession }));
        const client = { changeModel } as unknown as ProtocolHttpClient;
        const harness = createJustBashToolHarness();
        const agent = new RemoteAgent({
            client,
            context: harness.context,
            modelCatalog: catalog,
            session,
        });
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "/model");

        const modelMenu = stripAnsi(app.render(100).join("\n"));
        expect(modelMenu).toContain("Kimi Test");
        expect(modelMenu).toContain("Amazon Bedrock model");

        app.handleInput("\x1b[B");
        app.handleInput("\x1b[B");
        app.handleInput("\r");
        app.handleInput("\r");

        await vi.waitFor(() =>
            expect(changeModel).toHaveBeenCalledWith("session-1", {
                effort: "off",
                modelId: kimi.id,
                providerId: "bedrock",
            }),
        );
        await vi.waitFor(() => expect(agent.provider.id).toBe("bedrock"));
        expect(agent.model.id).toBe(kimi.id);
    });

    it("rolls back a rejected provider change without persisting cleared fast mode", async () => {
        const codexModel = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const claudeModel = defineModel({
            id: "anthropic/claude-test",
            name: "Claude Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const catalog: ModelCatalog = {
            defaultModelId: codexModel.id,
            defaultProviderId: "codex",
            models: [codexModel, claudeModel],
            providers: [
                { providerId: "codex", models: [codexModel], serviceTiers: ["fast"] },
                { providerId: "claude-sdk", models: [claudeModel] },
            ],
        };
        const snapshot = {
            id: "agent-1",
            messages: [],
            modelId: codexModel.id,
            providerId: "codex",
            queue: [],
            serviceTier: "fast" as const,
            status: "idle" as const,
            tools: [],
        };
        const session: ProtocolSession = {
            agent: { depth: 0, rootSessionId: "session-1", type: "primary" },
            agentId: snapshot.id,
            cwd: "/workspace",
            id: "session-1",
            modelId: codexModel.id,
            modelLocked: false,
            models: [codexModel],
            permissionMode: "workspace_write",
            mcpServers: [],
            pendingUserInputs: [],
            providerId: "codex",
            serviceTier: "fast",
            snapshot,
            status: "idle",
            tasks: [],
            titleStatus: "idle",
        };
        const changeModel = vi.fn().mockRejectedValue(new Error("provider unavailable"));
        const agent = new RemoteAgent({
            client: { changeModel } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog: catalog,
            session,
        });
        const defaultModelChanges: Array<{
            effort: string;
            modelId: string;
            providerId: string;
            serviceTier: "fast" | null;
        }> = [];
        const app = new CodingAssistantApp({
            agent,
            cwd: "/workspace",
            onDefaultModelChange: (preference) => {
                defaultModelChanges.push(preference);
            },
            processManager: new NativeProxessManager(),
            sessionBacked: true,
            tui: fakeTui(),
        });

        submit(app, "/model");
        app.handleInput("\x1b[B");
        app.handleInput("\r");
        app.handleInput("\r");

        expect(agent.provider.id).toBe("claude-sdk");
        expect(agent.snapshot().serviceTier).toBeUndefined();
        await vi.waitFor(() =>
            expect(stripAnsi(app.render(100).join("\n"))).toContain(
                "Could not change to Claude Test: provider unavailable",
            ),
        );
        expect(agent.provider.id).toBe("codex");
        expect(agent.snapshot().serviceTier).toBe("fast");
        expect(defaultModelChanges).toEqual([]);
        expect(stripAnsi(app.render(100).join("\n"))).toContain("gpt-test off fast ·");
    });

    it("does not persist a rejected fast tier through a later model change", async () => {
        const firstModel = defineModel({
            id: "openai/gpt-first",
            name: "GPT First",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const secondModel = defineModel({
            id: "openai/gpt-second",
            name: "GPT Second",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const catalog: ModelCatalog = {
            defaultModelId: firstModel.id,
            defaultProviderId: "codex",
            models: [firstModel, secondModel],
            providers: [
                {
                    providerId: "codex",
                    models: [firstModel, secondModel],
                    serviceTiers: ["fast"],
                },
            ],
        };
        const snapshot = {
            id: "agent-1",
            messages: [],
            modelId: firstModel.id,
            providerId: "codex",
            queue: [],
            status: "idle" as const,
            tools: [],
        };
        const session: ProtocolSession = {
            agent: { depth: 0, rootSessionId: "session-1", type: "primary" },
            agentId: snapshot.id,
            cwd: "/workspace",
            id: "session-1",
            modelId: firstModel.id,
            modelLocked: false,
            models: [firstModel, secondModel],
            permissionMode: "workspace_write",
            mcpServers: [],
            pendingUserInputs: [],
            providerId: "codex",
            snapshot,
            status: "idle",
            tasks: [],
            titleStatus: "idle",
        };
        const changedSession: ProtocolSession = {
            ...session,
            modelId: secondModel.id,
            snapshot: { ...snapshot, modelId: secondModel.id },
        };
        let resolveModelChange!: (value: { session: ProtocolSession }) => void;
        const modelChange = new Promise<{ session: ProtocolSession }>((resolve) => {
            resolveModelChange = resolve;
        });
        const changeModel = vi.fn(() => modelChange);
        const changeServiceTier = vi.fn().mockRejectedValue(new Error("fast unavailable"));
        const agent = new RemoteAgent({
            client: { changeModel, changeServiceTier } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog: catalog,
            session,
        });
        const defaultModelChanges: Array<{
            effort: string;
            modelId: string;
            providerId: string;
            serviceTier: "fast" | null;
        }> = [];
        const app = new CodingAssistantApp({
            agent,
            cwd: "/workspace",
            onDefaultModelChange: (preference) => {
                defaultModelChanges.push(preference);
            },
            processManager: new NativeProxessManager(),
            sessionBacked: true,
            tui: fakeTui(),
        });

        submit(app, "/fast on");
        submit(app, "/model");
        app.handleInput("\x1b[B");
        app.handleInput("\r");
        app.handleInput("\r");

        expect(agent.model.id).toBe(secondModel.id);
        expect(agent.snapshot().serviceTier).toBe("fast");
        await vi.waitFor(() => expect(changeModel).toHaveBeenCalledOnce());
        expect(agent.snapshot().serviceTier).toBeUndefined();
        resolveModelChange({ session: changedSession });
        await vi.waitFor(() =>
            expect(stripAnsi(app.render(100).join("\n"))).toContain(
                "Could not turn fast mode on: fast unavailable",
            ),
        );
        await vi.waitFor(() => expect(defaultModelChanges).toHaveLength(1));
        expect(agent.model.id).toBe(secondModel.id);
        expect(agent.snapshot().serviceTier).toBeUndefined();
        expect(defaultModelChanges).toEqual([
            {
                effort: "off",
                modelId: secondModel.id,
                providerId: "codex",
                serviceTier: null,
            },
        ]);
    });

    it("keeps model choices visible but locked during an active response", () => {
        const smallModel = defineModel({
            id: "openai/gpt-small",
            name: "GPT Small",
            thinkingLevels: ["low", "high"],
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
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            modelLocked: true,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "/model");

        const modelMenu = stripAnsi(app.render(100).join("\n"));
        expect(modelMenu).toContain("Choose Model");
        expect(modelMenu).toContain("Wait for the active response to finish");
        expect(modelMenu).toContain("GPT Small");
        expect(modelMenu).toContain("GPT Pro");
        expect(modelMenu).toContain("Unavailable while running");

        app.handleInput("\x1b[B");
        app.handleInput("\r");

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(agent.model.id).toBe(smallModel.id);
        expect(rendered).toContain(
            "Wait for the active response to finish before changing models.",
        );
    });

    it("changes only reasoning from the effort command", () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["low", "high"],
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
            modelLocked: true,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "/ford");

        const effortMenu = stripAnsi(app.render(100).join("\n"));
        expect(effortMenu).toContain("Choose Reasoning");
        expect(effortMenu).toContain("GPT Test");

        app.handleInput("\x1b[B");
        app.handleInput("\r");

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(agent.model.id).toBe(model.id);
        expect(agent.snapshot().effort).toBe("high");
        expect(rendered).toContain("Reasoning changed to High.");
    });

    it("toggles supported fast inference and shows it in the footer", () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["ultra"],
            defaultThinkingLevel: "ultra",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            serviceTiers: ["fast"],
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
        const defaultModelChanges: Array<{
            effort: string;
            modelId: string;
            providerId: string;
            serviceTier: "fast" | null;
        }> = [];
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            onDefaultModelChange: (preference) => {
                defaultModelChanges.push(preference);
            },
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "/fast");

        expect(agent.snapshot().serviceTier).toBe("fast");
        let rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("Fast mode is on. Fast inference uses 2× plan usage.");
        expect(rendered).toContain(
            "gpt-test ultra fast · /workspace · main [default] · full access",
        );

        submit(app, "/fast status");
        rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("Fast mode is on.");

        submit(app, "/fast off");

        expect(agent.snapshot().serviceTier).toBeUndefined();
        rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("Fast mode is off.");
        expect(rendered).toContain("gpt-test ultra · /workspace · main [default] · full access");
        expect(rendered).not.toContain("gpt-test ultra fast ·");
        submit(app, "/fast turbo");
        rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("Usage: /fast [on|off|status]");
        expect(defaultModelChanges).toEqual([
            {
                effort: "ultra",
                modelId: model.id,
                providerId: "codex",
                serviceTier: "fast",
            },
            {
                effort: "ultra",
                modelId: model.id,
                providerId: "codex",
                serviceTier: null,
            },
        ]);
    });

    it("keeps rapid fast config writes ordered with the final toggle", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["ultra"],
            defaultThinkingLevel: "ultra",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            serviceTiers: ["fast"],
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
        const enqueueWrite = createSerialTaskQueue();
        const writes: Array<"fast" | null> = [];
        let releaseFirstWrite!: () => void;
        const firstWriteGate = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            onDefaultModelChange: (preference) =>
                enqueueWrite(async () => {
                    if (preference.serviceTier === "fast") {
                        await firstWriteGate;
                    }
                    writes.push(preference.serviceTier);
                }),
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "/fast on");
        submit(app, "/fast off");

        expect(agent.snapshot().serviceTier).toBeUndefined();
        expect(stripAnsi(app.render(100).join("\n"))).not.toContain("gpt-test ultra fast ·");
        releaseFirstWrite();
        await vi.waitFor(() => expect(writes).toEqual(["fast", null]));
    });

    it("rolls back a rejected fast change without persisting it", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["ultra"],
            defaultThinkingLevel: "ultra",
        });
        const snapshot = {
            id: "agent-1",
            messages: [],
            modelId: model.id,
            providerId: "codex",
            queue: [],
            status: "idle" as const,
            tools: [],
        };
        const session: ProtocolSession = {
            agent: { depth: 0, rootSessionId: "session-1", type: "primary" },
            agentId: snapshot.id,
            cwd: "/workspace",
            id: "session-1",
            modelId: model.id,
            modelLocked: false,
            models: [model],
            permissionMode: "workspace_write",
            mcpServers: [],
            pendingUserInputs: [],
            providerId: "codex",
            snapshot,
            status: "idle",
            tasks: [],
            titleStatus: "idle",
        };
        const changeServiceTier = vi.fn().mockRejectedValue(new Error("daemon unavailable"));
        const agent = new RemoteAgent({
            client: { changeServiceTier } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: "codex",
                models: [model],
                providers: [{ models: [model], providerId: "codex", serviceTiers: ["fast"] }],
            },
            session,
        });
        const defaultModelChanges: Array<{
            effort: string;
            modelId: string;
            providerId: string;
            serviceTier: "fast" | null;
        }> = [];
        const app = new CodingAssistantApp({
            agent,
            cwd: "/workspace",
            onDefaultModelChange: (preference) => {
                defaultModelChanges.push(preference);
            },
            processManager: new NativeProxessManager(),
            sessionBacked: true,
            tui: fakeTui(),
        });

        submit(app, "/fast on");
        expect(agent.snapshot().serviceTier).toBe("fast");

        await vi.waitFor(() =>
            expect(stripAnsi(app.render(100).join("\n"))).toContain(
                "Could not turn fast mode on: daemon unavailable",
            ),
        );
        expect(agent.snapshot().serviceTier).toBeUndefined();
        expect(defaultModelChanges).toEqual([]);
        expect(stripAnsi(app.render(100).join("\n"))).not.toContain("gpt-test ultra fast ·");
    });

    it("only offers fast inference for providers that support it", async () => {
        const model = defineModel({
            id: "claude-test",
            name: "Claude Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const stream = vi.fn();
        const provider = defineProvider({
            id: "anthropic",
            models: [model],
            stream() {
                stream();
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

        submit(app, "/fast on");

        expect(agent.snapshot().serviceTier).toBeUndefined();
        expect(stream).not.toHaveBeenCalled();
        expect(stripAnsi(app.render(100).join("\n"))).toContain(
            "Fast inference is not available with Claude Test.",
        );

        app.focused = true;
        app.handleInput("/f");
        await delay(30);
        expect(stripAnsi(app.render(100).join("\n"))).not.toContain("/fast");
    });

    it("offers the fast command with a clear plan-usage description", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            serviceTiers: ["fast"],
            stream() {
                return streamText("unused");
            },
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        app.focused = true;
        app.handleInput("/f");
        await delay(30);

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("/fast");
        expect(rendered).toContain("Toggle fastest inference at 2× plan usage.");
    });

    it("renders service-tier changes received from a session", () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            serviceTiers: ["fast"],
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
            sessionBacked: true,
            tui: fakeTui(),
        });
        agent.setServiceTier("fast");

        app.applySessionEvent({
            createdAt: 1,
            data: {
                serviceTier: "fast",
                snapshot: agent.snapshot(),
            },
            id: "event-fast",
            sessionId: "session-1",
            type: "service_tier_changed",
        });

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("Fast mode is on. Fast inference uses 2× plan usage.");
        expect(rendered).toContain("gpt-test off fast · /workspace");
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
            showReasoning: true,
            tui: fakeTui(),
        });

        app.handleInput("\x1bm");

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered).toContain("Choose Model");
        expect(rendered).not.toContain("Ask Rig to do anything");
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
            showReasoning: true,
            tui: fakeTui(),
        });

        app.focused = true;
        app.handleInput("/");
        await delay(30);

        const rawLines = app.render(80);
        const rendered = stripAnsi(rawLines.join("\n"));
        const commandLine = rawLines.find((line) => stripAnsi(line).includes("/model"));
        expect(commandLine).not.toContain("\x1b[48;5;235m");
        expect(commandLine).toContain("\x1b[38;5;202m");
        expect(commandLine).not.toContain("\x1b[1m");
        expect(rendered).toContain("/model");
        expect(rendered).toContain("Choose the model and reasoning level.");
        expect(rendered).toContain("/effort");
        expect(rendered).toContain("Change reasoning for this session.");
        expect(rendered).toContain("/configure");
        expect(rendered).toContain("Configure app settings.");
        expect(rendered).toContain("/permissions");
        expect(rendered).toContain("Choose filesystem, shell, and network access.");
        expect(rendered).toContain("/mcp");
        expect(rendered).toContain("Show configured MCP server connections.");
        expect(rendered).toContain("/tasks");
        expect(rendered).toContain("Show the current session task list.");
        expect(rendered).not.toContain("GPT Test Off •");
        expect(rendered).not.toContain("/quit");

        app.handleInput("\r");
        const modelPicker = stripAnsi(app.render(80).join("\n"));
        expect(modelPicker).toContain("Choose Model");
        expect(modelPicker).not.toContain("/model");
    });

    it("shows MCP connection diagnostics from the mcp command", () => {
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
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            initialMcpServers: [
                { name: "docs", status: "connected", toolCount: 2 },
                {
                    errorMessage: "This MCP server is not trusted on this machine.",
                    name: "project helper",
                    status: "blocked",
                    toolCount: 0,
                },
                {
                    errorMessage: "The server process exited.",
                    name: "issues",
                    status: "failed",
                    toolCount: 0,
                },
            ],
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "/mcp");

        const rendered = stripAnsi(app.render(100).join("\n"));
        const normalized = rendered.replace(/\s+/gu, " ");
        expect(normalized).toContain("docs: connected with 2 tools");
        expect(normalized).toContain(
            "project helper: blocked — This MCP server is not trusted on this machine.",
        );
        expect(normalized).toContain("issues: could not connect — The server process exited.");

        app.applySessionEvent({
            createdAt: 1,
            data: {
                servers: [
                    {
                        errorMessage:
                            "MCP servers are available in Auto or Full access because they can act outside Rig's sandbox.",
                        name: "openai_developer_docs",
                        status: "blocked",
                        toolCount: 0,
                    },
                    {
                        errorMessage: "This MCP server is not trusted on this machine.",
                        name: "posthog",
                        status: "blocked",
                        toolCount: 0,
                    },
                ],
            },
            id: "mcp-blocked",
            sessionId: "session-1",
            type: "mcp_servers_changed",
        });
        const wideRows = stripAnsi(app.render(160).join("\n"))
            .split("\n")
            .map((row) => row.trimEnd());
        const wideParent = wideRows.findIndex((row) => row === "• MCP servers blocked");
        expect(wideRows.slice(wideParent, wideParent + 3)).toEqual([
            "• MCP servers blocked",
            "  └ OpenAI Developer Docs — MCP servers are available in Auto or Full access because they can act outside Rig's sandbox.",
            "    PostHog — This MCP server is not trusted on this machine.",
        ]);

        const narrowRows = stripAnsi(app.render(52).join("\n"))
            .split("\n")
            .map((row) => row.trimEnd());
        const narrowParent = narrowRows.findIndex((row) => row === "• MCP servers blocked");
        expect(narrowRows.slice(narrowParent, narrowParent + 6)).toEqual([
            "• MCP servers blocked",
            "  └ OpenAI Developer Docs — MCP servers are",
            "    available in Auto or Full access because they",
            "    can act outside Rig's sandbox.",
            "    PostHog — This MCP server is not trusted on this",
            "    machine.",
        ]);
        expect(narrowRows.every((row) => visibleWidth(row) <= 52)).toBe(true);
        expect(narrowRows.slice(narrowParent, narrowParent + 6).join("\n")).not.toMatch(/[│├↳]/u);

        app.applySessionEvent({
            createdAt: 2,
            data: {
                servers: [
                    {
                        errorMessage:
                            "MCP servers are available in Auto or Full access because they can act outside Rig's sandbox.",
                        name: "Trusted Helper",
                        status: "blocked",
                        toolCount: 0,
                    },
                ],
            },
            id: "mcp-permission-blocked",
            sessionId: "session-1",
            type: "mcp_servers_changed",
        });
        const permissionBlocked = stripAnsi(app.render(100).join("\n")).replace(/\s+/gu, " ");
        expect(permissionBlocked).toContain("OpenAI Developer Docs");
        expect(permissionBlocked).toContain("PostHog");
        expect(permissionBlocked).toContain(
            "Trusted Helper — MCP servers are available in Auto or Full access because they can act outside Rig's sandbox.",
        );
    });

    it("shows persisted task progress from the tasks command", () => {
        const model = defineModel({
            id: "anthropic/test",
            name: "Claude Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "claude-sdk",
            models: [model],
            stream() {
                return streamText("unused");
            },
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            initialTasks: [
                {
                    blockedBy: [],
                    blocks: [],
                    description: "Implement it.",
                    id: "1",
                    status: "in_progress",
                    subject: "Build the feature",
                },
                {
                    blockedBy: ["1"],
                    blocks: [],
                    description: "Test it.",
                    id: "2",
                    status: "pending",
                    subject: "Verify the feature",
                },
            ],
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "/tasks");

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("#1 · In progress · Build the feature");
        expect(rendered).toContain("#2 · Pending · Verify the feature");
    });

    it("shows delegated work status from the agents command", () => {
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
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            initialSubagents: [
                {
                    agentId: "agent-2",
                    createdAt: 1,
                    depth: 1,
                    description: "Inspect the implementation",
                    elapsedMs: 60_000,
                    id: "subagent-1",
                    modelId: model.id,
                    parentSessionId: "session-1",
                    status: "running",
                    taskName: "inspect_implementation",
                    totalTokens: 1_000,
                    updatedAt: 1,
                },
            ],
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });
        app.applySessionEvent({
            createdAt: 2,
            data: {
                subagent: {
                    agentId: "agent-2",
                    createdAt: 1,
                    depth: 1,
                    description: "Inspect the implementation",
                    elapsedMs: 65_000,
                    id: "subagent-1",
                    modelId: model.id,
                    parentSessionId: "session-1",
                    status: "completed",
                    taskName: "inspect_implementation",
                    totalTokens: 1_250,
                    updatedAt: 2,
                },
            },
            id: "event-1",
            sessionId: "session-1",
            type: "subagent_changed",
        });

        const statusTransition = stripAnsi(app.render(100).join("\n"));
        expect(statusTransition).not.toContain("agent running · /agents to view");
        expect(statusTransition.split("\n").map((line) => line.trimEnd())).toEqual(
            expect.arrayContaining([
                "• Background work",
                '  └ "Inspect the implementation" completed in 1m 5s · 1.3k tokens.',
            ]),
        );
        app.applySessionEvent({
            createdAt: 3,
            data: {
                displayText: 'Background work "Inspect the implementation" completed.',
                message: {
                    blocks: [{ text: "<subagent-notification>", type: "text" }],
                    id: "notification-1",
                    role: "user",
                },
                runId: "notification-run-1",
                source: "notification",
            },
            id: "event-2",
            sessionId: "session-1",
            type: "message_submitted",
        });
        const completed = stripAnsi(app.render(100).join("\n"));
        expect(completed).not.toContain("agent running · /agents to view");
        expect(completed.match(/"Inspect the implementation" completed/gu)).toHaveLength(1);

        submit(app, "/agents");

        expect(
            stripAnsi(app.render(100).join("\n"))
                .split("\n")
                .map((line) => line.trimEnd()),
        ).toEqual(
            expect.arrayContaining([
                "• Subagents",
                "  └ Completed · Inspect the implementation · 1m 5s · 1.3k tokens",
            ]),
        );
    });

    it("starts and manages a persistent goal from slash commands", async () => {
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
        let goal:
            | {
                  createdAt: number;
                  objective: string;
                  status: "active" | "blocked" | "complete" | "paused";
                  updatedAt: number;
              }
            | undefined;
        const setGoal = vi.fn(async (objective: string) => {
            goal = { createdAt: 1, objective, status: "active", updatedAt: 1 };
        });
        const changeGoalStatus = vi.fn(
            async (status: "active" | "blocked" | "complete" | "paused") => {
                if (goal !== undefined) goal = { ...goal, status, updatedAt: 2 };
            },
        );
        const clearGoal = vi.fn(async () => {
            goal = undefined;
        });
        Object.defineProperties(agent, {
            changeGoalStatus: { value: changeGoalStatus },
            clearGoal: { value: clearGoal },
            goal: { get: () => goal },
            setGoal: { value: setGoal },
        });
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "/goal Ship a verified release");
        await vi.waitFor(() => expect(setGoal).toHaveBeenCalledWith("Ship a verified release"));
        submit(app, "/goal");
        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("Status: Active");
        expect(rendered).toContain("Objective: Ship a verified release");

        submit(app, "/goal pause");
        await vi.waitFor(() => expect(changeGoalStatus).toHaveBeenCalledWith("paused"));
        submit(app, "/goal clear");
        await vi.waitFor(() => expect(clearGoal).toHaveBeenCalledOnce());
    });

    it("compacts conversation history from the compact command", async () => {
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
                return streamText("A concise continuation brief.");
            },
        });
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            messages: [
                {
                    role: "user",
                    id: "user-1",
                    blocks: [{ type: "text", text: "Do the work." }],
                },
                {
                    role: "agent",
                    id: "agent-1",
                    blocks: [{ type: "text", text: "The work is done." }],
                },
            ],
            printToConsole: false,
        });
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });
        const compact = vi.spyOn(agent, "compact");

        for (const character of "/compact") app.handleInput(character);
        app.handleInput("\r");
        const compaction = compact.mock.results[0];
        expect(compaction?.type).toBe("return");
        if (compaction?.type !== "return") throw new Error("Compaction did not start.");
        await compaction.value;

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered).toContain("Compacted 2 older messages.");
        expect(rendered).toContain("The full transcript remains visible.");
        expect(agent.snapshot().messages).toHaveLength(2);
        expect(agent.snapshot().contextMessages).toHaveLength(1);
    });

    it("rejects overlapping submissions while conversation compaction is running", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const started = deferred<void>();
        const release = deferred<void>();
        let requests = 0;
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                requests += 1;
                return streamTextStart(
                    "A concise continuation brief.",
                    started.resolve,
                    release.promise,
                );
            },
        });
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            messages: [
                {
                    role: "user",
                    id: "user-1",
                    blocks: [{ type: "text", text: "Do the work." }],
                },
                {
                    role: "agent",
                    id: "agent-1",
                    blocks: [{ type: "text", text: "The work is done." }],
                },
            ],
            printToConsole: false,
        });
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });
        const compact = vi.spyOn(agent, "compact");

        for (const character of "/compact") app.handleInput(character);
        app.handleInput("\r");
        const compaction = compact.mock.results[0];
        expect(compaction?.type).toBe("return");
        if (compaction?.type !== "return") throw new Error("Compaction did not start.");
        await started.promise;
        for (const character of "new prompt") app.handleInput(character);
        app.handleInput("\r");

        expect(stripAnsi(app.render(80).join("\n"))).toContain(
            "Wait for conversation compaction to finish before submitting.",
        );
        expect(requests).toBe(1);
        expect(agent.queue).toEqual([]);

        release.resolve();
        await compaction.value;
        expect(agent.snapshot().contextMessages).toHaveLength(1);
    });

    it("renders file mentions in the slash-command footer and completes them", async () => {
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
        const searchFiles = vi.fn(async () => [
            {
                fileName: "CodingAssistantApp.ts",
                path: "packages/rig/sources/app/CodingAssistantApp.ts",
            },
            {
                fileName: "createCodingAssistantAgent.ts",
                path: "packages/rig/sources/app/createCodingAssistantAgent.ts",
            },
        ]);
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            searchFiles,
            tui: fakeTui(),
        });

        app.focused = true;
        for (const character of "Review @coding") {
            app.handleInput(character);
        }
        await delay(160);

        expect(searchFiles).toHaveBeenLastCalledWith("coding");
        const rawLines = app.render(100);
        const mentionLine = rawLines.find((line) =>
            stripAnsi(line).includes("CodingAssistantApp.ts"),
        );
        expect(mentionLine).toBeDefined();
        expect(mentionLine).toContain("\x1b[38;5;202m");
        expect(mentionLine).not.toContain("\x1b[48;5;235m");
        expect(stripAnsi(mentionLine ?? "")).not.toContain("@CodingAssistantApp.ts");
        expect(stripAnsi(mentionLine ?? "")).toContain(
            "packages/rig/sources/app/CodingAssistantApp.ts",
        );

        app.handleInput("x");
        const renderedWhileSearching = stripAnsi(app.render(100).join("\n"));
        expect(renderedWhileSearching).toContain("Review @codingx");
        expect(renderedWhileSearching).toContain("CodingAssistantApp.ts");

        await delay(160);
        app.handleInput("\x1b");
        app.handleInput("y");
        expect(stripAnsi(app.render(100).join("\n"))).toContain("Review @codingxy");

        await delay(160);
        app.handleInput("\x1b[B");
        app.handleInput("\t");
        expect(stripAnsi(app.render(100).join("\n"))).toContain(
            "Review @packages/rig/sources/app/createCodingAssistantAgent.ts ",
        );
    });

    it("shows loaded skills as slash command autocomplete items", async () => {
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
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/.git": "gitdir: here",
                "/workspace/.agents/skills/review/SKILL.md":
                    "---\nname: review\ndescription: Review changes carefully.\n---\n\n# Review\n",
            },
        });
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
        await delay(30);
        app.handleInput("/skill:");
        await delay(30);

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("/skill:review");
        expect(rendered).toContain("Review changes carefully.");
    });

    it("limits visible skill slash command autocomplete rows", async () => {
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
        const skillFiles = Object.fromEntries(
            Array.from({ length: 24 }, (_, index) => {
                const name = `skill-${index.toString().padStart(2, "0")}`;
                return [
                    `/workspace/.agents/skills/${name}/SKILL.md`,
                    `---\nname: ${name}\ndescription: Skill ${index} with a long description that should stay on one rendered row.\n---\n\n# ${name}\n`,
                ];
            }),
        );
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/.git": "gitdir: here",
                ...skillFiles,
            },
        });
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
        await delay(30);
        app.handleInput("/skill:");
        await delay(30);

        const visibleSkillRows = stripAnsi(app.render(100).join("\n"))
            .split("\n")
            .filter((line) => line.includes("/skill:skill-"));
        expect(visibleSkillRows).toHaveLength(6);
        expect(visibleSkillRows[0]).toContain("/skill:skill-00");
        expect(visibleSkillRows[5]).toContain("/skill:skill-05");
    });

    it("renders each skill autocomplete suggestion as a single terminal row", async () => {
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
        const skillFiles = Object.fromEntries(
            Array.from({ length: 12 }, (_, index) => {
                const name = `skill-${index.toString().padStart(2, "0")}`;
                return [
                    `/workspace/.agents/skills/${name}/SKILL.md`,
                    [
                        "---",
                        `name: ${name}`,
                        "description: |",
                        "  First description line that is intentionally too long for a narrow terminal.",
                        "  Second description line must not become a second physical row.",
                        "---",
                        "",
                        `# ${name}`,
                    ].join("\n"),
                ];
            }),
        );
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/.git": "gitdir: here",
                ...skillFiles,
            },
        });
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            printToConsole: false,
        });
        const tui = fakeTui({ rows: 10, columns: 48 });
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui,
        });

        app.focused = true;
        await delay(30);
        app.handleInput("/skill:");
        await delay(30);
        vi.mocked(tui.requestRender).mockClear();
        app.handleInput("\x1b[B");
        app.handleInput("\x1b[B");
        app.handleInput("\x1b[A");

        const width = 48;
        const lines = app.render(width);
        const physicalRows = stripAnsi(lines.join("\n")).split("\n");
        const autocompleteRows = lines.filter((line) => stripAnsi(line).includes("/skill:skill-"));

        expect(tui.requestRender).toHaveBeenCalled();
        expect(tui.requestRender).not.toHaveBeenCalledWith(true);
        expect(physicalRows).toHaveLength(lines.length);
        expect(autocompleteRows).toHaveLength(6);
        for (const row of autocompleteRows) {
            expect(row).not.toContain("\n");
            expect(visibleWidth(row)).toBeLessThan(width);
        }
    });

    it("keeps transcript history while slash autocomplete is open", async () => {
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
                return streamText("answer with enough text to leave transcript rows behind");
            },
        });
        const skillFiles = Object.fromEntries(
            Array.from({ length: 20 }, (_, index) => {
                const name = `skill-${index.toString().padStart(2, "0")}`;
                return [
                    `/workspace/.agents/skills/${name}/SKILL.md`,
                    `---\nname: ${name}\ndescription: Skill ${index}.\n---\n\n# ${name}\n`,
                ];
            }),
        );
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/.git": "gitdir: here",
                ...skillFiles,
            },
        });
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
            tui: fakeTui({ rows: 8 }),
        });

        submit(app, "first");
        await app.waitForIdle();
        submit(app, "second");
        await app.waitForIdle();
        app.focused = true;
        app.handleInput("/skill:");
        await delay(30);

        const lines = app.render(100);
        const rendered = stripAnsi(lines.join("\n"));
        expect(lines.length).toBeGreaterThan(8);
        expect(rendered).toContain("› first");
        expect(rendered).toContain("› second");
        expect(rendered).toContain("• answer with enough text to leave transcript rows behind");
        expect(rendered).toContain("› /skill:");
        expect(rendered).toContain("/skill:skill-00");
        expect(rendered).toContain("/skill:skill-05");
        expect(rendered).not.toContain("/skill:skill-06");
    });

    it("uses normal diff redraw while navigating a large skill autocomplete list", async () => {
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
        const skillFiles = Object.fromEntries(
            Array.from({ length: 30 }, (_, index) => {
                const name = `skill-${index.toString().padStart(2, "0")}`;
                return [
                    `/workspace/.agents/skills/${name}/SKILL.md`,
                    `---\nname: ${name}\ndescription: Skill ${index}.\n---\n\n# ${name}\n`,
                ];
            }),
        );
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/.git": "gitdir: here",
                ...skillFiles,
            },
        });
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            printToConsole: false,
        });
        const tui = fakeTui({ rows: 8 });
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui,
        });

        app.focused = true;
        await delay(30);
        app.handleInput("/skill:");
        await delay(30);
        vi.mocked(tui.requestRender).mockClear();

        app.handleInput("\x1b[B");
        app.handleInput("\x1b[B");
        app.handleInput("\x1b[A");

        expect(tui.requestRender).toHaveBeenCalled();
        expect(tui.requestRender).not.toHaveBeenCalledWith(true);
        expect(app.render(100).length).toBeGreaterThan(8);
    });

    it("expands a skill slash command before sending it to the model", async () => {
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
                return streamText("skill used");
            },
        });
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/.git": "gitdir: here",
                "/workspace/.agents/skills/review/SKILL.md": [
                    "---",
                    "name: review",
                    "description: Review changes carefully.",
                    "allowed-tools:",
                    "  - Bash",
                    "---",
                    "",
                    "# Review",
                    "Use the word cobalt.",
                ].join("\n"),
            },
        });
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

        submit(app, "/skill:review inspect this diff");
        await app.waitForIdle();

        const sentContent = contexts[0]?.messages[0]?.content[0];
        const sentText =
            typeof sentContent === "string"
                ? sentContent
                : sentContent?.type === "text"
                  ? sentContent.text
                  : "";
        expect(sentText).toContain(
            '<skill name="review" location="/workspace/.agents/skills/review/SKILL.md">',
        );
        expect(sentText).toContain("References are relative to /workspace/.agents/skills/review.");
        expect(sentText).toContain("# Review");
        expect(sentText).toContain("Use the word cobalt.");
        expect(sentText).toContain("</skill>\n\ninspect this diff");
        expect(sentText).not.toContain("allowed-tools");

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("› /skill:review inspect this diff");
        expect(rendered).toContain("• skill used");
        expect(rendered).not.toContain("Use the word cobalt.");
    });

    it("restores transcript entries from session events", () => {
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
        const initialSessionEvents: SessionEvent[] = [
            {
                createdAt: 1_700_000_000_000,
                data: {
                    displayText: "resume this",
                    message: {
                        blocks: [{ text: "resume this", type: "text" }],
                        id: "user-message-1",
                        role: "user",
                    },
                    runId: "run-1",
                },
                id: "018bcfe5-6800-7001-8000-000000000001",
                sessionId: "session-1",
                type: "message_submitted",
            },
            {
                createdAt: 1_700_000_000_001,
                data: {
                    message: {
                        blocks: [{ text: "restored answer", type: "text" }],
                        id: "message-1",
                        role: "agent",
                    },
                    runId: "run-1",
                },
                id: "018bcfe5-6801-7001-8000-000000000002",
                sessionId: "session-1",
                type: "agent_message",
            },
            {
                createdAt: 1_700_000_000_002,
                data: {
                    agentRunId: "agent-run-1",
                    modelLocked: false,
                    runId: "run-1",
                    stopReason: "stop",
                },
                id: "018bcfe5-6802-7001-8000-000000000003",
                sessionId: "session-1",
                type: "run_finished",
            },
        ];
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            initialSessionEvents,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("› resume this");
        expect(rendered).toContain("• restored answer");
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
            showReasoning: true,
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

    it("dismisses the model menu before Ctrl+C exits", async () => {
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

        expect(stripAnsi(app.render(80).join("\n"))).toContain("Ask Rig to do anything");

        app.handleInput("\x1bm");
        app.handleInput("\x03");
        expect(tui.stop).not.toHaveBeenCalled();

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
            showReasoning: true,
            tui: fakeTui(),
        });

        submit(app, "work");
        await started.promise;
        app.handleInput("/");
        expect(stripAnsi(app.render(80).join("\n"))).toContain("/model");
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
        expect(rendered).toContain("› /");
    });

    it("uses Enter to steer and Tab to queue while a run is active", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const gate = createTextStartStreamGate("first response");
        const contexts: Context[] = [];
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                return contexts.length === 1 ? gate.stream() : streamText("done");
            },
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "first");
        await gate.startedText;
        app.handleInput("queued later");
        app.handleInput("\t");
        const queued = stripAnsi(app.render(100).join("\n"));
        expect(queued).toContain("↳ queued queued later");
        expect(queued).not.toContain("Enter steers");
        expect(queued).not.toContain("Tab queues");

        submit(app, "steer now");
        gate.release();
        await app.waitForIdle();

        expect(contexts).toHaveLength(3);
        expect(contexts[1]?.messages.at(-1)).toMatchObject({
            role: "user",
            content: [{ type: "text", text: "steer now" }],
        });
        expect(contexts[2]?.messages.at(-1)).toMatchObject({
            role: "user",
            content: [{ type: "text", text: "queued later" }],
        });
    });

    it("restores queued prompts to the composer when Escape interrupts", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const started = deferred<void>();
        let requests = 0;
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, _context, options) {
                requests += 1;
                return streamAbortAfterSignal(options?.signal, started.resolve);
            },
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "first");
        await started.promise;
        app.handleInput("queued follow-up");
        app.handleInput("\t");
        app.handleInput("current draft");
        app.handleInput("\x1b");
        await app.waitForIdle();

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(requests).toBe(1);
        expect(rendered).toContain("› queued follow-up");
        expect(rendered).toContain("  current draft");
        expect(rendered).not.toContain("↳ queued");
    });

    it("keeps the composer cursor steady without idle redraws", () => {
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
            vi.mocked(tui.requestRender).mockClear();
            vi.advanceTimersByTime(530);
            expect(app.render(80).join("\n")).toContain("\x1b[48;5;244m\x1b[38;5;232m ");

            vi.advanceTimersByTime(530);
            expect(app.render(80).join("\n")).toContain("\x1b[48;5;244m\x1b[38;5;232m ");
            expect(tui.requestRender).not.toHaveBeenCalled();
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
        expect(inputLine).toContain("\x1b[48;5;244m\x1b[38;5;232mb\x1b[48;5;235m\x1b[39m");
    });

    it("inserts bracketed paste into the composer", () => {
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

        app.handleInput("\x1b[200~hello from clipboard\x1b[201~");

        expect(stripAnsi(app.render(80).join("\n"))).toContain("› hello from clipboard");
    });

    it("inserts split bracketed paste chunks into the composer", () => {
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

        app.handleInput("\x1b[200~multi ");
        app.handleInput("chunk");
        app.handleInput(" paste\x1b[201~");

        expect(stripAnsi(app.render(80).join("\n"))).toContain("› multi chunk paste");
    });

    it("pastes clipboard images as chips and sends image content", async () => {
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
            readClipboardImage: async () => ({
                data: validPng32Base64,
                mediaType: "image/png",
                path: "/workspace/.context/clipboard-images/image.png",
            }),
            tui: fakeTui(),
        });

        app.handleInput("\x16");
        await delay(0);

        const raw = app.render(80).join("\n");
        expect(stripAnsi(raw)).toContain("› [Image #1 PNG]");
        expect(raw).toContain("\x1b[48;5;240m\x1b[38;5;255m[Image #1 PNG]");

        app.handleInput("\r");
        await app.waitForIdle();

        expect(contexts[0]?.messages[0]).toMatchObject({
            role: "user",
            content: [{ type: "image", mimeType: "image/png", data: validPng32Base64 }],
        });
        expect(stripAnsi(app.render(80).join("\n"))).toContain("› [Image #1 PNG]");
    });

    it("pastes multiple clipboard images into one prompt", async () => {
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
        const images = [
            {
                data: validPng32Base64,
                mediaType: "image/png",
                path: "/workspace/.context/clipboard-images/first.png",
            },
            {
                data: validJpeg32Base64,
                mediaType: "image/jpeg",
                path: "/workspace/.context/clipboard-images/second.jpg",
            },
        ];
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
            readClipboardImage: async () => images.shift(),
            tui: fakeTui(),
        });

        app.handleInput("compare ");
        app.handleInput("\x16");
        await delay(0);
        app.handleInput("and ");
        app.handleInput("\x16");
        await delay(0);

        expect(stripAnsi(app.render(100).join("\n"))).toContain(
            "› compare [Image #1 PNG] and [Image #2 JPG]",
        );

        app.handleInput("\r");
        await app.waitForIdle();

        expect(contexts[0]?.messages[0]).toMatchObject({
            role: "user",
            content: [
                { type: "text", text: "compare " },
                { type: "image", mimeType: "image/png", data: validPng32Base64 },
                { type: "text", text: " and " },
                { type: "image", mimeType: "image/jpeg", data: validJpeg32Base64 },
            ],
        });
    });

    it("keeps long multiline input scrollable around the cursor", () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream: () => streamText("unused"),
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui({ rows: 10 }),
        });

        for (let line = 1; line <= 9; line += 1) {
            app.handleInput(`line ${line}`);
            if (line < 9) app.handleInput("\x1b[13;2~");
        }

        expect(stripAnsi(app.render(80).join("\n"))).toContain("↑ 4 more");
        for (let line = 1; line <= 8; line += 1) app.handleInput("\x1b[A");
        expect(stripAnsi(app.render(80).join("\n"))).toContain("↓ 4 more");
    });

    it("hides the composer cursor while the terminal is unfocused", () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream: () => streamText("unused"),
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        app.focused = true;
        app.handleInput("draft");
        expect(app.render(80).join("\n")).toContain("\x1b[48;5;244m");

        app.handleInput("\x1b[O");
        expect(app.render(80).join("\n")).not.toContain("\x1b[48;5;244m");
    });

    it("inserts plain multi-character paste without treating it as shortcuts", () => {
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

        app.handleInput("/model");

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered).toContain("› /model");
        expect(rendered).not.toContain("Choose Model");
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
        const inputLineIndex = renderedLines.findIndex((line) => line.includes("› h"));
        expect(inputLineIndex).toBeGreaterThan(0);
        expect(rawLines[inputLineIndex - 1]).toContain("\x1b[48;5;235m");
        expect(rawLines[inputLineIndex]).toContain("\x1b[39m");
        expect(rawLines[inputLineIndex + 1]).toContain("\x1b[48;5;235m");
    });

    it("clears input on the first Ctrl+C and exits on the next press", async () => {
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
        expect(tui.stop).not.toHaveBeenCalled();

        app.handleInput("\x03");
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

        app.handleInput("\x1b[A");
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
            line.includes(
                "────────────────────────────────────────────────────────────────────────────────",
            ),
        );

        expect(userLineIndex).toBeGreaterThan(0);
        expect(separatorLineIndex).toBe(-1);
    });

    it("reports provider token usage and shows optional live footer status", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
            contextWindow: 200_000,
        });
        const usage: Usage = {
            input: 1_200,
            output: 300,
            cacheRead: 100,
            cacheWrite: 0,
            totalTokens: 1_600,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return streamMessage({
                    role: "assistant",
                    content: [{ type: "text", text: "Measured." }],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage,
                    stopReason: "stop",
                    timestamp: 1,
                });
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
            showUsage: true,
            tui: fakeTui(),
        });

        submit(app, "Measure this turn.");
        await app.waitForIdle();
        expect(stripAnsi(app.render(100).join("\n"))).toContain("1.6k tokens · 99% left");

        submit(app, "/usage");
        const report = stripAnsi(app.render(100).join("\n"));
        expect(report).toContain("Input: 1.2k");
        expect(report).toContain("Output: 300");
        expect(report).toContain("Total processed: 1.6k");

        submit(app, "/new");
        submit(app, "/usage");
        expect(stripAnsi(app.render(100).join("\n"))).toContain("Total processed: 0");
    });

    it("renders the durable backend usage summary for session-backed agents", async () => {
        const model = defineModel({
            contextWindow: 200_000,
            defaultThinkingLevel: "off",
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream: () => streamText("unused"),
        });
        const harness = createJustBashToolHarness();
        const agent = Object.assign(
            new Agent({
                context: harness.context,
                modelId: model.id,
                printToConsole: false,
                provider,
            }),
            {
                getUsage: vi.fn(async () => ({
                    context: {
                        approximate: false,
                        modelId: model.id,
                        providerId: "codex",
                        requestedModelId: model.id,
                        totalTokens: 1_300,
                    },
                    currentProviderId: "codex",
                    groups: [
                        {
                            kind: "attributed" as const,
                            modelId: model.id,
                            providerId: "codex",
                            usage: {
                                cacheRead: 40,
                                cacheWrite: 30,
                                cost: {
                                    cacheRead: 0,
                                    cacheWrite: 0,
                                    input: 0,
                                    output: 0,
                                    total: 0,
                                },
                                input: 1_200,
                                output: 100,
                                totalTokens: 1_370,
                            },
                        },
                    ],
                    observedQuota: [],
                    quotas: [
                        {
                            providerId: "codex",
                            quota: {
                                capturedAt: 1,
                                source: "codex" as const,
                                windows: {
                                    fiveHour: {
                                        capturedAt: 1,
                                        resetsAt: 8_041_000,
                                        status: "available" as const,
                                        usedPercent: 32,
                                    },
                                    weekly: { status: "unavailable" as const },
                                },
                            },
                        },
                    ],
                })),
            },
        );
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            now: () => 1_000,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "/usage");
        await vi.waitFor(() => {
            const rows = stripAnsi(app.render(64).join("\n"))
                .split("\n")
                .map((row) => row.trimEnd());
            const usageIndex = rows.indexOf("• Usage");
            expect(rows.slice(usageIndex, usageIndex + 11)).toEqual([
                "• Usage",
                "  └ Codex",
                "      GPT Test",
                "        1.4k total · 1.2k input · 100 output · 40 cache read ·",
                "        30 cache write",
                "        Context: 1.3k / 200k · 99.4% left",
                "      Account quota",
                "        5-hour: 68% left · resets in 2h 14m",
                "        Weekly: unavailable",
                "    Session total: 1.4k",
                "",
            ]);
            expect(rows.filter((row) => row.includes("└"))).toEqual(["  └ Codex"]);
            expect(rows.every((row) => visibleWidth(row) <= 64)).toBe(true);
        });
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
            expect(stripAnsi(visibleCursor)).toContain("› Ask Rig to do anything");
            expect(stripAnsi(visibleCursor)).not.toContain("›  Ask Rig to do anything");

            vi.mocked(tui.requestRender).mockClear();
            vi.advanceTimersByTime(530);

            const steadyCursor = app.render(80).join("\n");
            expect(steadyCursor).toContain("\x1b[48;5;244m\x1b[38;5;232mA");
            expect(stripAnsi(steadyCursor)).toContain("› Ask Rig to do anything");
            expect(stripAnsi(steadyCursor)).not.toContain("›  Ask Rig to do anything");
            expect(tui.requestRender).not.toHaveBeenCalled();
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
        const composerLines = app
            .render(80)
            .filter((line) => line.includes("\x1b[48;5;235m") && line.includes("\x1b[39m"));
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
                                arguments: {
                                    cmd: "printf 'line one\\nline two\\n'",
                                    shell: "/bin/zsh",
                                },
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
        expect(raw).toContain("\x1b[38;5;202m\x1b[1mRan\x1b[22m");
        expect(raw).toContain("\x1b[38;5;75mprintf\x1b[39m");
        expect(raw).toContain("\x1b[38;5;71m'line one\\nline two\\n'\x1b[39m");
        expect(rendered).toContain("• Ran printf 'line one\\nline two\\n'");
        expect(rendered).toContain("  └ line one");
        expect(rendered).toContain("    line two");
        expect(rendered).not.toContain("│");
        const resultLines = rendered.split("\n").filter((line) => /^[ ]+└ /u.test(line));
        expect(resultLines).toHaveLength(1);
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

    it("renders structured MCP calls, replayed results, errors, and approval detail", () => {
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
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        app.applySessionEvent({
            createdAt: 1,
            data: {
                message: {
                    blocks: [
                        {
                            arguments: { title: "List tabs", timeout_ms: 30_000 },
                            id: "mcp-success",
                            name: "mcp__node_repl__js",
                            type: "tool_call",
                        },
                        {
                            display: "Node Repl · Js",
                            isError: false,
                            rendered: [
                                { type: "text", text: "{ ready: true }" },
                                { type: "text", text: "tabs: 3" },
                            ],
                            toolCallId: "mcp-success",
                            toolName: "mcp__node_repl__js",
                            type: "tool_result",
                        },
                        {
                            arguments: {
                                arguments: { query: "TUI" },
                                name: "find_docs",
                                server: "search",
                            },
                            id: "mcp-error",
                            name: "call_mcp_tool",
                            type: "tool_call",
                        },
                        {
                            display: "Called Find Docs from Search",
                            isError: true,
                            rendered: [
                                { type: "text", text: "Error: network timeout" },
                                { type: "text", text: "Try again later." },
                            ],
                            toolCallId: "mcp-error",
                            toolName: "call_mcp_tool",
                            type: "tool_result",
                        },
                        {
                            arguments: { issue: 42 },
                            id: "mcp-pending",
                            name: "mcp__issues__close_ticket",
                            type: "tool_call",
                        },
                    ],
                    id: "mcp-message",
                    role: "agent",
                },
                runId: "run-1",
            },
            id: "mcp-agent-message",
            sessionId: "session-1",
            type: "agent_message",
        });
        app.applySessionEvent({
            createdAt: 2,
            data: {
                event: {
                    action: "Close ticket 42",
                    decision: "ask",
                    reason: "This changes external issue state.",
                    risk: "medium",
                    toolCallId: "mcp-pending",
                    type: "permission_review",
                    userAuthorization: "low",
                },
                runId: "run-1",
            },
            id: "mcp-permission",
            sessionId: "session-1",
            type: "agent_event",
        });
        app.applySessionEvent({
            createdAt: 3,
            data: {
                event: {
                    display: "Waiting for approval",
                    toolCallId: "mcp-pending",
                    type: "tool_execution_progress",
                },
                runId: "run-1",
            },
            id: "mcp-progress",
            sessionId: "session-1",
            type: "agent_event",
        });

        const raw = app.render(120).join("\n");
        const rendered = stripAnsi(raw);
        expect(rendered).toContain(
            '• Called node_repl.js({"title":"List tabs","timeout_ms":30000})',
        );
        expect(rendered).toContain("  └ { ready: true }");
        expect(rendered).toContain("    tabs: 3");
        expect(rendered).toContain('• Called search.find_docs({"query":"TUI"})');
        expect(rendered).toContain("  └ Error: network timeout");
        expect(rendered).toContain("    Try again later.");
        expect(rendered).not.toContain("Failed search.find_docs");
        expect(rendered).toContain('◦ Calling issues.close_ticket({"issue":42})');
        expect(rendered).toContain("Needs approval: This changes external issue state.");
        expect(rendered).toContain("Waiting for approval");
        expect(raw).toContain("\x1b[36mnode_repl");
        expect(raw).toContain("\x1b[31m\x1b[1m•");

        app.applySessionEvent({
            createdAt: 4,
            data: {
                errorMessage: "The daemon restarted during the tool call.",
                modelLocked: false,
                runId: "run-1",
            },
            id: "mcp-run-error",
            sessionId: "session-1",
            type: "run_error",
        });
        const afterRunError = stripAnsi(app.render(120).join("\n"));
        expect(afterRunError).not.toContain('◦ Calling issues.close_ticket({"issue":42})');
        expect(afterRunError).toContain('• Called issues.close_ticket({"issue":42})');
        expect(afterRunError).toContain("Interrupted.");
    });

    it("replays durable syntax-highlighted file diffs and never presents failed changes", () => {
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
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });
        const successfulPresentation = {
            type: "file_diff" as const,
            files: [
                {
                    path: "src/greet.ts",
                    kind: "update" as const,
                    hunks: [
                        {
                            oldStart: 1,
                            newStart: 1,
                            lines: [
                                {
                                    kind: "context" as const,
                                    text: "export function greet(name: string) {",
                                },
                                {
                                    kind: "delete" as const,
                                    text: "  return `goodbye, ${name}`;",
                                },
                                {
                                    kind: "add" as const,
                                    text: "  return `hello, ${name}`;",
                                },
                                { kind: "context" as const, text: "}" },
                            ],
                        },
                    ],
                },
            ],
        };

        app.applySessionEvent({
            createdAt: 1,
            data: {
                message: {
                    blocks: [
                        {
                            arguments: { patch: "successful patch" },
                            id: "patch-success",
                            name: "apply_patch",
                            type: "tool_call",
                        },
                        {
                            display: "Applied patch",
                            isError: false,
                            presentation: successfulPresentation,
                            rendered: [{ type: "text", text: "Success." }],
                            toolCallId: "patch-success",
                            toolName: "apply_patch",
                            type: "tool_result",
                        },
                        {
                            arguments: { patch: "failed patch" },
                            id: "patch-error",
                            name: "apply_patch",
                            type: "tool_call",
                        },
                        {
                            display: "Tool 'apply_patch' failed: hunk did not match",
                            isError: true,
                            presentation: {
                                type: "file_diff",
                                files: [
                                    {
                                        path: "SHOULD_NOT_RENDER.ts",
                                        kind: "add",
                                        hunks: [],
                                    },
                                ],
                            },
                            rendered: [
                                {
                                    type: "text",
                                    text: "Tool 'apply_patch' failed: hunk did not match",
                                },
                            ],
                            toolCallId: "patch-error",
                            toolName: "apply_patch",
                            type: "tool_result",
                        },
                        {
                            arguments: { patch: "empty patch" },
                            id: "patch-empty",
                            name: "apply_patch",
                            type: "tool_call",
                        },
                        {
                            display: "Applied patch",
                            isError: false,
                            presentation: { type: "file_diff", files: [] },
                            rendered: [{ type: "text", text: "Applied patch" }],
                            toolCallId: "patch-empty",
                            toolName: "apply_patch",
                            type: "tool_result",
                        },
                    ],
                    id: "patch-message",
                    role: "agent",
                },
                runId: "run-1",
            },
            id: "patch-agent-message",
            sessionId: "session-1",
            type: "agent_message",
        });

        const raw = app.render(100).join("\n");
        const rendered = stripAnsi(raw);
        expect(rendered).toContain("• Edited src/greet.ts (+1 -1)");
        expect(rendered).toContain("    2 -  return `goodbye, ${name}`;");
        expect(rendered).toContain("    2 +  return `hello, ${name}`;");
        expect(rendered).toContain("• Failed Apply patch");
        expect(rendered).toContain("hunk did not match");
        expect(rendered).not.toContain("SHOULD_NOT_RENDER");
        expect(rendered).toContain("• Edited Apply patch");
        expect(rendered).toContain("  └ Applied patch");
        expect(raw).toContain("\x1b[48;5;52m");
        expect(raw).toContain("\x1b[48;5;22m");
        expect(raw).toContain("\x1b[38;2;148;226;213mexport");

        app.applySessionEvent({
            createdAt: 2,
            data: {
                message: {
                    blocks: [
                        {
                            display: "Applied large patch",
                            isError: false,
                            presentation: {
                                type: "file_diff",
                                omittedFiles: 4,
                                files: Array.from({ length: 20 }, (_, fileIndex) => ({
                                    path: `generated/file-${fileIndex}.ts`,
                                    kind: "add" as const,
                                    hunks: [
                                        {
                                            oldStart: 0,
                                            newStart: 1,
                                            lines: Array.from({ length: 20 }, (_, lineIndex) => ({
                                                kind: "add" as const,
                                                text: `export const value${lineIndex} = ${lineIndex};`,
                                            })),
                                        },
                                    ],
                                })),
                            },
                            rendered: [{ type: "text", text: "Applied large patch" }],
                            toolCallId: "patch-large",
                            toolName: "apply_patch",
                            type: "tool_result",
                        },
                    ],
                    id: "patch-large-message",
                    role: "agent",
                },
                runId: "run-2",
            },
            id: "patch-large-agent-message",
            sessionId: "session-1",
            type: "agent_message",
        });

        const largeRendered = app.render(100).map(stripAnsi);
        const largeStart = largeRendered.findIndex((line) =>
            line.includes("• Added generated/file-0.ts"),
        );
        const largeEnd = largeRendered.findIndex(
            (line, index) => index >= largeStart && line.includes("more rows"),
        );
        const omittedFilesRow = largeRendered.findIndex(
            (line, index) => index >= largeStart && line.includes("… 4 more files"),
        );
        expect(largeStart).toBeGreaterThanOrEqual(0);
        expect(largeEnd).toBeGreaterThan(largeStart);
        expect(omittedFilesRow).toBeGreaterThan(largeEnd);
        expect(omittedFilesRow - largeStart + 1).toBe(120);
    });

    it("names an unavailable model tool instead of presenting its argument as the failed action", async () => {
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
                                id: "unavailable-tool-call",
                                name: "erase_everything",
                                arguments: { path: "/workspace/protected.txt" },
                            },
                        ],
                        api: "test",
                        provider: "codex",
                        model: model.id,
                        usage: zeroUsage(),
                        stopReason: "toolUse",
                        timestamp: 1,
                    });
                }

                return streamText("done");
            },
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "Check the file without changing it.");
        await app.waitForIdle();

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("• Failed Erase everything");
        expect(rendered).toContain(
            'The model requested "Erase everything", but that tool is not available in this session.',
        );
        expect(rendered).not.toContain("• Failed /workspace/protected.txt");
        expect(rendered).not.toContain("erase_everything");

        const narrowRendered = stripAnsi(app.render(60).join("\n")).replace(/\s+/gu, " ");
        expect(narrowRendered).toContain(
            'The model requested "Erase everything", but that tool is not available in this session.',
        );
    });

    it("keeps progress active until execution ends and clears it after interruption", () => {
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
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });
        const toolCall = {
            arguments: { cmd: "printf progress" },
            id: "progress-tool",
            name: "exec_command",
            type: "toolCall" as const,
        };

        app.applySessionEvent({
            createdAt: 0,
            data: { runId: "run-1" },
            id: "event-run-start",
            sessionId: "session-1",
            type: "run_started",
        });
        app.applySessionEvent({
            createdAt: 1,
            data: {
                message: {
                    blocks: [
                        {
                            arguments: toolCall.arguments,
                            id: toolCall.id,
                            name: toolCall.name,
                            type: "tool_call",
                        },
                    ],
                    id: "tool-message",
                    role: "agent",
                },
                runId: "run-1",
            },
            id: "event-message",
            sessionId: "session-1",
            type: "agent_message",
        });
        app.applySessionEvent({
            createdAt: 2,
            data: { event: { toolCall, type: "tool_execution_start" }, runId: "run-1" },
            id: "event-start",
            sessionId: "session-1",
            type: "agent_event",
        });
        app.applySessionEvent({
            createdAt: 3,
            data: {
                event: {
                    display: "Processed 5 rows",
                    toolCallId: toolCall.id,
                    type: "tool_execution_progress",
                },
                runId: "run-1",
            },
            id: "event-progress",
            sessionId: "session-1",
            type: "agent_event",
        });
        app.applySessionEvent({
            createdAt: 3,
            data: {
                event: {
                    status: "Awaiting for workflow to complete",
                    toolCallId: toolCall.id,
                    type: "tool_execution_status",
                },
                runId: "run-1",
            },
            id: "event-status",
            sessionId: "session-1",
            type: "agent_event",
        });

        const active = stripAnsi(app.render(80).join("\n"));
        expect(active).toContain("• Running printf progress");
        expect(active).toContain("└ Processed 5 rows");
        expect(active).toContain("Awaiting for workflow to complete");
        expect(active).not.toContain("Running 1 tool");
        expect(active).not.toContain("• Ran printf progress");

        app.applySessionEvent({
            createdAt: 4,
            data: {
                event: {
                    result: {
                        display: "Command finished with exit code 0.",
                        isError: false,
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        type: "tool_result",
                    },
                    type: "tool_execution_end",
                },
                runId: "run-1",
            },
            id: "event-end",
            sessionId: "session-1",
            type: "agent_event",
        });

        const completed = stripAnsi(app.render(80).join("\n"));
        expect(completed).toContain("• Ran printf progress");
        expect(completed).toContain("└ Command finished with exit code 0.");
        expect(completed).not.toContain("• Running printf progress");

        app.applySessionEvent({
            createdAt: 5,
            data: {
                agentRunId: "agent-run-1",
                modelLocked: false,
                runId: "run-1",
                stopReason: "stop",
            },
            id: "event-run-finished",
            sessionId: "session-1",
            type: "run_finished",
        });
        const interruptedToolCall = {
            arguments: { cmd: "sleep 10" },
            id: "interrupted-tool",
            name: "exec_command",
            type: "toolCall" as const,
        };
        app.applySessionEvent({
            createdAt: 6,
            data: { runId: "run-2" },
            id: "event-interrupted-run-start",
            sessionId: "session-1",
            type: "run_started",
        });
        app.applySessionEvent({
            createdAt: 7,
            data: {
                message: {
                    blocks: [
                        {
                            arguments: interruptedToolCall.arguments,
                            id: interruptedToolCall.id,
                            name: interruptedToolCall.name,
                            type: "tool_call",
                        },
                    ],
                    id: "interrupted-tool-message",
                    role: "agent",
                },
                runId: "run-2",
            },
            id: "event-interrupted-message",
            sessionId: "session-1",
            type: "agent_message",
        });
        app.applySessionEvent({
            createdAt: 8,
            data: {
                event: { toolCall: interruptedToolCall, type: "tool_execution_start" },
                runId: "run-2",
            },
            id: "event-interrupted-start",
            sessionId: "session-1",
            type: "agent_event",
        });
        app.applySessionEvent({
            createdAt: 9,
            data: {
                event: {
                    display: "Waiting for the command",
                    toolCallId: interruptedToolCall.id,
                    type: "tool_execution_progress",
                },
                runId: "run-2",
            },
            id: "event-interrupted-progress",
            sessionId: "session-1",
            type: "agent_event",
        });
        expect(stripAnsi(app.render(80).join("\n"))).toContain("• Running sleep 10");

        app.applySessionEvent({
            createdAt: 10,
            data: {
                event: {
                    error: {
                        api: "test",
                        content: [],
                        model: model.id,
                        provider: provider.id,
                        role: "assistant",
                        stopReason: "aborted",
                        timestamp: 10,
                        usage: zeroUsage(),
                    },
                    reason: "aborted",
                    type: "error",
                },
                runId: "run-2",
            },
            id: "event-interrupted-error",
            sessionId: "session-1",
            type: "agent_event",
        });
        app.applySessionEvent({
            createdAt: 11,
            data: {
                agentRunId: "agent-run-2",
                modelLocked: false,
                runId: "run-2",
                stopReason: "aborted",
            },
            id: "event-interrupted-finished",
            sessionId: "session-1",
            type: "run_finished",
        });

        const interrupted = stripAnsi(app.render(80).join("\n"));
        expect(interrupted).toContain("Session interrupted");
        expect(interrupted).toContain("• Stopped sleep 10");
        expect(interrupted).not.toContain("• Running sleep 10");
        expect(interrupted).not.toContain("• Ran sleep 10");
        expect(app.render(80).join("\n")).toContain(
            "\x1b[31m•\x1b[0m \x1b[38;5;202m\x1b[1mStopped",
        );

        app.applySessionEvent({
            createdAt: 12,
            data: { runId: "run-3" },
            id: "event-later-run-start",
            sessionId: "session-1",
            type: "run_started",
        });
        const laterRun = stripAnsi(app.render(80).join("\n"));
        expect(laterRun).toContain("• Stopped sleep 10");
        expect(laterRun).not.toContain("• Running sleep 10");
        expect(laterRun).not.toContain("• Ran sleep 10");
        app.applySessionEvent({
            createdAt: 13,
            data: {
                agentRunId: "agent-run-3",
                modelLocked: false,
                runId: "run-3",
                stopReason: "stop",
            },
            id: "event-later-run-finished",
            sessionId: "session-1",
            type: "run_finished",
        });
    });

    it("shows Working while a tool call is still being generated", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        let streamCalls = 0;
        const gate = createToolCallStartStreamGate();
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                streamCalls += 1;
                if (streamCalls === 1) {
                    return gate.stream();
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
        await gate.startedToolCall;

        const renderedWhileToolCallStreams = stripAnsi(app.render(80).join("\n"));
        expect(renderedWhileToolCallStreams).toContain("• I will inspect files.");
        expect(renderedWhileToolCallStreams).toContain("◦ Working");
        expect(renderedWhileToolCallStreams.match(/◦ Working/gu)).toHaveLength(1);
        expect(renderedWhileToolCallStreams).not.toContain("printf ok");
        expect(renderedWhileToolCallStreams).not.toContain("Ran");
        expect(renderedWhileToolCallStreams).not.toContain("Used Working");

        gate.release();
        await app.waitForIdle();

        const renderedAfterToolCall = stripAnsi(app.render(80).join("\n"));
        expect(renderedAfterToolCall).toContain("• Ran printf ok");
        expect(renderedAfterToolCall).toContain("└ ok");
        expect(renderedAfterToolCall).not.toContain("◦ Working");
        expect(renderedAfterToolCall.match(/Ran printf ok/gu)).toHaveLength(1);
    });

    it("removes an incomplete Working placeholder when a streamed tool call is interrupted", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const gate = createToolCallStartStreamGate();
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream: () => gate.stream(),
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
        await gate.startedToolCall;
        app.handleInput("\x1b");

        const interrupted = stripAnsi(app.render(80).join("\n"));
        expect(interrupted).toContain("Session interrupted");
        expect(interrupted).not.toContain("Working");
        expect(interrupted).not.toContain("printf ok");

        gate.release();
        await app.waitForIdle();
    });

    it("sanitizes terminal controls from shell progress and results", async () => {
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
                                id: "tool-call-ansi",
                                name: "exec_command",
                                arguments: { cmd: "printf '\\033[2Junsafe'" },
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

        submit(app, "use tool");
        await app.waitForIdle();

        const raw = app.render(80).join("\n");
        expect(raw).not.toContain("\x1b[2J");
        expect(stripAnsi(raw)).toContain("└ unsafe");
    });

    it("renders one completion separator after the final response across tool cycles", async () => {
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
                if (streamCalls <= 2) {
                    return streamMessage({
                        role: "assistant",
                        content: [
                            {
                                type: "toolCall",
                                id: `tool-call-${String(streamCalls)}`,
                                name: "exec_command",
                                arguments: { cmd: `printf tool-${String(streamCalls)}` },
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
        const separator =
            "────────────────────────────────────────────────────────────────────────────────";
        expect(streamCalls).toBe(3);
        expect(rendered).toContain("• Ran printf tool-1");
        expect(rendered).toContain("└ tool-1");
        expect(rendered).toContain("• Ran printf tool-2");
        expect(rendered).toContain("└ tool-2");
        expect(rendered.match(new RegExp(separator, "gu"))).toHaveLength(1);
        expect(rendered.indexOf("• after tools")).toBeLessThan(rendered.indexOf(separator));
    });

    it("places completion directly after the tool result when there is no final text", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        let now = 0;
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
                                id: "tool-call-no-final-text",
                                name: "exec_command",
                                arguments: { cmd: "printf tool-only" },
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

                now = 65_000;
                return streamMessage({
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
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            now: () => now,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "use one tool");
        await app.waitForIdle();

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered.indexOf("└ tool-only")).toBeLessThan(rendered.indexOf("Worked for 1m 5s"));
        expect(rendered.match(/Worked for/gu)).toHaveLength(1);
    });

    it("keeps completion before a queued follow-up turn", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        let now = 0;
        let streamCalls = 0;
        const gate = createBeforeTextStartStreamGate("first answer");
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
                                id: "tool-before-queued-turn",
                                name: "exec_command",
                                arguments: { cmd: "printf queued-tool" },
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
                if (streamCalls === 2) return gate.stream();
                return streamText("queued answer");
            },
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            now: () => now,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "use a tool first");
        await gate.started;
        app.handleInput("queued follow-up");
        app.handleInput("\t");
        now = 65_000;
        gate.release();
        await app.waitForIdle();

        const rendered = stripAnsi(app.render(80).join("\n"));
        const firstAnswer = rendered.indexOf("• first answer");
        const completion = rendered.indexOf("Worked for 1m 5s");
        const queuedUser = rendered.indexOf("› queued follow-up");
        const queuedAnswer = rendered.indexOf("• queued answer");
        expect([firstAnswer, completion, queuedUser, queuedAnswer]).toEqual(
            [...new Set([firstAnswer, completion, queuedUser, queuedAnswer])].sort(
                (left, right) => left - right,
            ),
        );
        expect(rendered.match(/Worked for/gu)).toHaveLength(1);
    });

    it("does not leak deferred completion after a tool-using provider error", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        let now = 0;
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
                                id: "tool-before-error",
                                name: "exec_command",
                                arguments: { cmd: "printf before-error" },
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

                now = 65_000;
                return streamMessage({
                    role: "assistant",
                    content: [],
                    api: "test",
                    provider: "codex",
                    model: "openai/gpt-test",
                    usage: zeroUsage(),
                    stopReason: "error",
                    errorMessage: "SCRIPTED_PROVIDER_ERROR",
                    timestamp: 1,
                });
            },
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            now: () => now,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "fail after the tool");
        await app.waitForIdle();

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered).toContain("SCRIPTED_PROVIDER_ERROR");
        expect(rendered).not.toContain("Worked for");
    });

    it("does not leak deferred completion after a tool-using interruption", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        let now = 0;
        let streamCalls = 0;
        const started = deferred<void>();
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, _context, options) {
                streamCalls += 1;
                if (streamCalls === 1) {
                    return streamMessage({
                        role: "assistant",
                        content: [
                            {
                                type: "toolCall",
                                id: "tool-before-interruption",
                                name: "exec_command",
                                arguments: { cmd: "printf before-interruption" },
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
                return streamAbortAfterSignal(options?.signal, () => started.resolve());
            },
        });
        const harness = createJustBashToolHarness();
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            now: () => now,
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "interrupt after the tool");
        await started.promise;
        now = 65_000;
        app.handleInput("\x1b");
        await app.waitForIdle();

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered).toContain("Session interrupted");
        expect(rendered).not.toContain("Worked for");
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
        expect(renderedDuringSecondTurn).not.toContain(
            "────────────────────────────────────────────────────────────────────────────────",
        );
        expect(renderedDuringSecondTurn).toContain("◦ Working");
        expect(renderedDuringSecondTurn.match(/◦ Working/gu)).toHaveLength(1);
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
        const thinkingLine =
            rawWhileThinking.find((line) => stripAnsi(line).includes("◦ Thinking")) ?? "";
        const renderedWhileThinking = stripAnsi(rawWhileThinking.join("\n"));
        expect(renderedWhileThinking).toContain("◦ Thinking (1m 5s · esc to interrupt)");
        expect(renderedWhileThinking).toContain("gpt-test high");
        expect(renderedWhileThinking).not.toContain("Idle |");
        expect(thinkingLine).toContain("\x1b[38;5;255m");
        expect(thinkingLine).toContain("\x1b[38;5;244m");
        expect(thinkingLine).toContain("\x1b[2m\x1b[2m\x1b[39m(1m 5s · esc to interrupt)");
        expect(thinkingLine).not.toContain("\x1b[38;5;255m(");
        expect(thinkingLine).not.toContain("\x1b[38;5;244m(");

        gate.release();
        await app.waitForIdle();
    });

    it("does not add elapsed history for a permission-only conversational turn", () => {
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
        let now = 10_000;
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            now: () => now,
            processManager: new NativeProxessManager(),
            sessionBacked: true,
            tui: fakeTui(),
        });

        app.applySessionEvent({
            createdAt: 10_000,
            data: {
                displayText: "Complete the task.",
                message: {
                    blocks: [{ text: "Complete the task.", type: "text" }],
                    id: "user-message-1",
                    role: "user",
                },
                runId: "run-1",
            },
            id: "event-user-message",
            sessionId: "session-1",
            type: "message_submitted",
        });
        app.applySessionEvent({
            createdAt: 10_001,
            data: { runId: "run-1" },
            id: "event-run-started",
            sessionId: "session-1",
            type: "run_started",
        });

        now = 40_000;
        app.applySessionEvent({
            createdAt: 40_000,
            data: {
                questions: [
                    {
                        header: "Permission",
                        id: "permission",
                        multiSelect: false,
                        options: [
                            { label: "Allow", description: "Run this command once." },
                            { label: "Deny", description: "Do not run this command." },
                        ],
                        question: "Allow this command?",
                    },
                ],
                requestId: "tool-call-1:permission",
            },
            id: "event-permission-requested",
            sessionId: "session-1",
            type: "user_input_requested",
        });
        app.applySessionEvent({
            createdAt: 60_000,
            data: {
                answers: { permission: ["Allow"] },
                requestId: "tool-call-1:permission",
                status: "answered",
            },
            id: "event-permission-resolved",
            sessionId: "session-1",
            type: "user_input_resolved",
        });

        now = 75_000;
        app.applySessionEvent({
            createdAt: 75_000,
            data: {
                message: {
                    blocks: [{ text: "TASK_COMPLETE", type: "text" }],
                    id: "agent-message-1",
                    role: "agent",
                },
                runId: "run-1",
            },
            id: "event-agent-message",
            sessionId: "session-1",
            type: "agent_message",
        });
        app.applySessionEvent({
            createdAt: 75_000,
            data: {
                agentRunId: "agent-run-1",
                modelLocked: false,
                runId: "run-1",
                stopReason: "stop",
            },
            id: "event-run-finished",
            sessionId: "session-1",
            type: "run_finished",
        });

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain("TASK_COMPLETE");
        expect(rendered).not.toContain("Worked for");
        expect(rendered).not.toContain("esc to interrupt");
    });

    it("renders completed thinking blocks as transcript text", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["high"],
            defaultThinkingLevel: "high",
        });
        const message: AssistantMessage = {
            role: "assistant",
            content: [
                {
                    type: "thinking",
                    thinking: "I should **inspect** `renderer` before changing the UI.",
                },
                { type: "text", text: "Done." },
            ],
            api: "test",
            provider: "codex",
            model: "openai/gpt-test",
            usage: zeroUsage(),
            stopReason: "stop",
            timestamp: 1,
        };
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return streamMessage(message);
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
            processManager: new NativeProxessManager(),
            showReasoning: true,
            tui: fakeTui(),
        });

        submit(app, "show reasoning");
        await app.waitForIdle();

        const raw = app.render(100).join("\n");
        const rendered = stripAnsi(raw);
        expect(rendered).toContain("• I should inspect renderer before changing the UI.");
        expect(rendered).not.toContain("Thinking");
        expect(rendered).toContain("• Done.");
        expect(raw).toContain("\x1b[2m•\x1b[0m");
        expect(raw).toContain("\x1b[1m");
    });

    it("renders streamed thinking deltas without duplicating the final block", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["high"],
            defaultThinkingLevel: "high",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return streamThinkingText(
                    "I should read the transcript renderer and then update tests.",
                    "Done.",
                );
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
            processManager: new NativeProxessManager(),
            showReasoning: true,
            tui: fakeTui(),
        });

        submit(app, "show streamed reasoning");
        await app.waitForIdle();

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(rendered).toContain(
            "• I should read the transcript renderer and then update tests.",
        );
        expect(rendered).not.toContain("Thinking");
        expect(
            rendered.split("I should read the transcript renderer and then update tests."),
        ).toHaveLength(2);
        expect(rendered).toContain("• Done.");
    });

    it("toggles reasoning display from the configure menu", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["high"],
            defaultThinkingLevel: "high",
        });
        const message: AssistantMessage = {
            role: "assistant",
            content: [
                {
                    type: "thinking",
                    thinking: "This reasoning text can be hidden.",
                },
                { type: "text", text: "Final answer stays visible." },
            ],
            api: "test",
            provider: "codex",
            model: "openai/gpt-test",
            usage: zeroUsage(),
            stopReason: "stop",
            timestamp: 1,
        };
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return streamMessage(message);
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
        const settingsChanges: Array<{
            completionChime: boolean;
            durableGlobalEventQueue: boolean;
            showReasoning: boolean;
            showUsage: boolean;
        }> = [];
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            onSettingsChange: (settings) => {
                settingsChanges.push(settings);
            },
            processManager: new NativeProxessManager(),
            tui: fakeTui(),
        });

        submit(app, "show reasoning");
        await app.waitForIdle();

        expect(stripAnsi(app.render(100).join("\n"))).not.toContain(
            "This reasoning text can be hidden.",
        );

        submit(app, "/configure");
        const menu = stripAnsi(app.render(100).join("\n"));
        expect(menu).toContain("Configure");
        expect(menu).toContain("Show reasoning");
        expect(menu).toContain("Show token status");
        expect(menu).toContain("Enable completion chime");
        expect(menu).toContain("Enable durable event queue");

        app.handleInput("\r");

        const rendered = stripAnsi(app.render(100).join("\n"));
        expect(settingsChanges).toEqual([
            {
                completionChime: false,
                durableGlobalEventQueue: false,
                showReasoning: true,
                showUsage: false,
            },
        ]);
        expect(rendered).toContain("This reasoning text can be hidden.");
        expect(rendered).toContain("Final answer stays visible.");
        expect(rendered).toContain("Reasoning display enabled.");

        submit(app, "/configure");
        app.handleInput("\x1b[B");
        app.handleInput("\x1b[B");
        app.handleInput("\r");

        expect(settingsChanges.at(-1)).toEqual({
            completionChime: true,
            durableGlobalEventQueue: false,
            showReasoning: true,
            showUsage: false,
        });
        expect(stripAnsi(app.render(100).join("\n"))).toContain("Completion chime enabled.");

        submit(app, "/configure");
        app.handleInput("\x1b[B");
        app.handleInput("\x1b[B");
        app.handleInput("\x1b[B");
        app.handleInput("\r");

        expect(settingsChanges.at(-1)).toEqual({
            completionChime: true,
            durableGlobalEventQueue: true,
            showReasoning: true,
            showUsage: false,
        });
        expect(stripAnsi(app.render(100).join("\n"))).toContain("Durable event queue enabled.");
    });

    it("changes the session permission mode from the permissions menu", () => {
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
        harness.context.permissions = createPermissionContext("workspace_write");
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

        submit(app, "/permissions");

        const menu = stripAnsi(app.render(100).join("\n"));
        expect(menu).toContain("Choose Permissions");
        expect(menu).toContain("Auto");
        expect(menu).toContain("Workspace write");
        expect(menu).toContain("Read only");
        expect(menu).toContain("Full access");
        expect(menu).toContain("Applies to this session and its subagents");

        app.handleInput("\x1b[B");
        app.handleInput("\r");

        expect(agent.permissionMode).toBe("read_only");
        expect(stripAnsi(app.render(100).join("\n"))).toContain(
            "Permissions changed to Read only.",
        );
    });

    it("collects structured questions and sends a free-form answer", async () => {
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
        const respondUserInput = vi.fn(async () => undefined);
        const app = new CodingAssistantApp({
            agent,
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            respondUserInput,
            tui: fakeTui(),
        });
        const request = {
            requestId: "call-1",
            questions: [
                {
                    header: "Database",
                    id: "database",
                    multiSelect: false,
                    options: [
                        { label: "PostgreSQL", description: "Use the relational stack." },
                        { label: "SQLite", description: "Keep local setup small." },
                    ],
                    question: "Which database should be used?",
                },
                {
                    header: "Region",
                    id: "region",
                    multiSelect: false,
                    options: [
                        { label: "US West", description: "Deploy near the current team." },
                        { label: "US East", description: "Deploy near most customers." },
                    ],
                    question: "Which region should host it?",
                },
            ],
        };

        app.applySessionEvent({
            createdAt: 1,
            data: request,
            id: "event-1",
            sessionId: "session-1",
            type: "user_input_requested",
        });

        expect(stripAnsi(app.render(100).join("\n"))).toContain(
            "Which database should be used? · 1 of 2",
        );
        app.handleInput("\r");
        expect(stripAnsi(app.render(100).join("\n"))).toContain(
            "Which region should host it? · 2 of 2",
        );

        app.handleInput("\x1b[B");
        app.handleInput("\x1b[B");
        app.handleInput("\r");
        expect(stripAnsi(app.render(100).join("\n"))).toContain("Type another answer");
        app.handleInput("Europe West");
        app.handleInput("\r");

        await vi.waitFor(() =>
            expect(respondUserInput).toHaveBeenCalledWith("call-1", {
                answers: {
                    database: ["PostgreSQL"],
                    region: ["Europe West"],
                },
            }),
        );
    });

    it("collects multiple selections for one structured question", async () => {
        const model = defineModel({
            id: "anthropic/test",
            name: "Claude Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "claude-sdk",
            models: [model],
            stream() {
                return streamText("unused");
            },
        });
        const harness = createJustBashToolHarness();
        const respondUserInput = vi.fn(async () => undefined);
        const app = new CodingAssistantApp({
            agent: new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                printToConsole: false,
            }),
            cwd: harness.context.fs.cwd,
            processManager: new NativeProxessManager(),
            respondUserInput,
            tui: fakeTui(),
        });

        app.applySessionEvent({
            createdAt: 1,
            data: {
                requestId: "call-2",
                questions: [
                    {
                        header: "Alerts",
                        id: "question_1",
                        multiSelect: true,
                        options: [
                            { label: "Email", description: "Send email alerts." },
                            { label: "Push", description: "Send device alerts." },
                        ],
                        question: "Which alert channels should be enabled?",
                    },
                ],
            },
            id: "event-2",
            sessionId: "session-1",
            type: "user_input_requested",
        });

        app.handleInput("\r");
        expect(stripAnsi(app.render(100).join("\n"))).toContain("✓ Email");
        app.handleInput("\x1b[B");
        app.handleInput("\r");
        app.handleInput("\x1b[B");
        app.handleInput("\x1b[B");
        app.handleInput("\r");

        await vi.waitFor(() =>
            expect(respondUserInput).toHaveBeenCalledWith("call-2", {
                answers: { question_1: ["Email", "Push"] },
            }),
        );
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
        expect(renderedAfterTextStart).toContain("◦ Working");
        expect(renderedAfterTextStart).not.toContain("• \n");

        gate.release();
        await app.waitForIdle();

        const renderedAfterDelta = stripAnsi(app.render(80).join("\n"));
        expect(renderedAfterDelta).toContain("• done");
        expect(renderedAfterDelta).not.toContain("◦ Working");
    });

    it("keeps stable transcript rows as source for a width-change redraw", async () => {
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
        expect(rendered).not.toContain(
            "────────────────────────────────────────────────────────────────────────────────",
        );

        const resized = stripAnsi(app.render(48).join("\n"));
        expect(resized).toContain("██████╗");
        expect(resized).toContain("› first");
        expect(resized).toContain("• answer 4");
        expect(resized).toContain("Ask Rig to do anything");

        submit(app, "fifth");
        await app.waitForIdle();
        const nextTurn = stripAnsi(app.render(48).join("\n"));
        expect(nextTurn).toContain("› fifth");
        expect(nextTurn).toContain("• answer 5");
        expect(nextTurn).toContain("› fourth");
    });
});

function createDeterministicIds(): () => string {
    let next = 0;
    return () => `app-id-${++next}`;
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

    override async killAll(..._args: Parameters<NativeProxessManager["killAll"]>): Promise<void> {
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

function createToolCallStartStreamGate(): {
    release: () => void;
    startedToolCall: Promise<void>;
    stream: () => InferenceStream;
} {
    let release: () => void = () => {};
    let startedToolCall: () => void = () => {};
    const releasePromise = new Promise<void>((resolve) => {
        release = resolve;
    });
    const startedToolCallPromise = new Promise<void>((resolve) => {
        startedToolCall = resolve;
    });

    return {
        release,
        startedToolCall: startedToolCallPromise,
        stream() {
            return streamTextThenToolCall(startedToolCall, releasePromise);
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

function streamTextThenToolCall(
    startedToolCall: () => void,
    releasePromise: Promise<void>,
): InferenceStream {
    const text = "I will inspect files.";
    const toolCall = {
        type: "toolCall" as const,
        id: "tool-call-1",
        name: "exec_command",
        arguments: { cmd: "printf ok" },
    };
    const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text }, toolCall],
        api: "test",
        provider: "codex",
        model: "openai/gpt-test",
        usage: zeroUsage(),
        stopReason: "toolUse",
        timestamp: 1,
    };

    return {
        async *[Symbol.asyncIterator]() {
            yield { type: "start" as const, partial: message };
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
            yield { type: "toolcall_start" as const, contentIndex: 1, partial: message };
            yield {
                type: "toolcall_delta" as const,
                contentIndex: 1,
                delta: '{"cmd":"printf ok"}',
                partial: message,
            };
            startedToolCall();
            await releasePromise;
            yield {
                type: "toolcall_end" as const,
                contentIndex: 1,
                toolCall,
                partial: message,
            };
            yield { type: "done" as const, reason: "toolUse", message };
        },
        async result() {
            return message;
        },
    };
}

function streamThinkingText(thinking: string, text: string): InferenceStream {
    const message: AssistantMessage = {
        role: "assistant",
        content: [
            { type: "thinking", thinking },
            { type: "text", text },
        ],
        api: "test",
        provider: "codex",
        model: "openai/gpt-test",
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp: 1,
    };
    const midpoint = Math.floor(thinking.length / 2);

    return {
        async *[Symbol.asyncIterator]() {
            yield { type: "start" as const, partial: message };
            yield { type: "thinking_start" as const, contentIndex: 0, partial: message };
            yield {
                type: "thinking_delta" as const,
                contentIndex: 0,
                delta: thinking.slice(0, midpoint),
                partial: message,
            };
            yield {
                type: "thinking_delta" as const,
                contentIndex: 0,
                delta: thinking.slice(midpoint),
                partial: message,
            };
            yield {
                type: "thinking_end" as const,
                contentIndex: 0,
                content: thinking,
                partial: message,
            };
            yield { type: "text_start" as const, contentIndex: 1, partial: message };
            yield {
                type: "text_delta" as const,
                contentIndex: 1,
                delta: text,
                partial: message,
            };
            yield {
                type: "text_end" as const,
                contentIndex: 1,
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

function streamBeforeTextStart(text: string, releasePromise: Promise<void>): InferenceStream {
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
