/* eslint-disable no-control-regex -- Terminal rendering intentionally parses ANSI controls. */
import { createId } from "@paralleldrive/cuid2";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
    CURSOR_MARKER,
    Editor,
    matchesKey,
    truncateToWidth,
    visibleWidth,
    wrapTextWithAnsi,
    type AutocompleteItem,
    type Component,
    type EditorTheme,
    type Focusable,
    type TUI,
} from "@earendil-works/pi-tui";

import {
    type AgentLoopEvent,
    type ContentBlock,
    type Message,
    type Skill,
    type ToolResultBlock,
    formatSkillInvocation,
    loadSkills,
} from "../agent/index.js";
import { parseSkillFrontmatter } from "../agent/skills/parseSkillFrontmatter.js";
import type { NativeProxessManager } from "../processes/index.js";
import type { Usage } from "../providers/types.js";
import type {
    FileSearchResult,
    McpServerSummary,
    SessionEvent,
    SessionTask,
    SubagentSummary,
} from "../protocol/index.js";
import type { UserInputRequest, UserInputResponse } from "../user-input/index.js";
import { createCodeReviewPrompt } from "../review/index.js";
import type { AppTranscriptEntry } from "./AppTranscriptEntry.js";
import type {
    CodingAssistantAgentBackend,
    CodingAssistantModelChoice,
} from "./CodingAssistantAgentBackend.js";
import { createSelectionPanel } from "./createSelectionPanel.js";
import { createSlashCommands, type SlashCommandItem } from "./createSlashCommands.js";
import { describeModelChoice } from "./describeModelChoice.js";
import { describeReasoningLevel } from "./describeReasoningLevel.js";
import { encodeModelChoice } from "./encodeModelChoice.js";
import { formatActivityElapsedTime } from "./formatActivityElapsedTime.js";
import { FileMentionAutocomplete } from "./FileMentionAutocomplete.js";
import type { FileMentionContext } from "./findFileMentionContext.js";
import { formatFileMention } from "./formatFileMention.js";
import { humanizeReasoningLevel } from "./humanizeReasoningLevel.js";
import { humanizePermissionMode } from "./humanizePermissionMode.js";
import { humanizeGoalStatus } from "./humanizeGoalStatus.js";
import { humanizeToolName } from "./humanizeToolName.js";
import {
    readClipboardImage,
    type ClipboardImage,
    type ReadClipboardImageOptions,
} from "./readClipboardImage.js";
import { ACTIVITY_WAVE_FRAME_COUNT, renderActivityWave } from "./renderActivityWave.js";
import { renderAgentMarkdown } from "./renderAgentMarkdown.js";
import { sanitizeTerminalText } from "./sanitizeTerminalText.js";
import { upsertSubagentSummary } from "./upsertSubagentSummary.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NOT_BOLD_OR_DIM = "\x1b[22m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RIG_ORANGE = "\x1b[38;5;202m";
const CURSOR_BG = "\x1b[48;5;244m";
const CURSOR_FG = "\x1b[38;5;232m";
const SURFACE_BG = "\x1b[48;5;236m";
const SURFACE_FG = "\x1b[38;5;252m";
const INPUT_FG = "\x1b[38;5;255m";
const SURFACE_MUTED_FG = "\x1b[38;5;245m";
const FOOTER_MODEL_FG = "\x1b[38;5;252m";
const FOOTER_CWD_FG = "\x1b[38;5;245m";
const FOOTER_QUEUED_FG = "\x1b[38;5;246m";
const INPUT_PLACEHOLDER = "Ask Rig to do anything";
const INPUT_PROMPT = "› ";
const INPUT_LINE_INDENT = "  ";
const PENDING_TOOL_CALL_TITLE = "Working";
const CURSOR_BLINK_MS = 530;
const CURSOR_TYPING_DEBOUNCE_MS = 530;
const ACTIVITY_ANIMATION_MS = 120;
const REASONING_DOWN_RAW_KEYS = new Set(["\x1b,", "\x1b[1;2B"]);
const REASONING_UP_RAW_KEYS = new Set(["\x1b.", "\x1b[1;2A"]);
const MODEL_MENU_RAW_KEYS = new Set(["\x1bm", "\x1bM"]);
const IMAGE_PASTE_RAW_KEYS = new Set(["\x16", "\x1bv"]);
const AUTOCOMPLETE_MAX_VISIBLE = 6;
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const TERMINAL_FOCUS_IN = "\x1b[I";
const TERMINAL_FOCUS_OUT = "\x1b[O";
const IMAGE_PLACEHOLDER_REGEX = /\[Image #(\d+) [A-Z0-9]+\]/gu;
const IMAGE_CHIP_BG = "\x1b[48;5;240m";
const IMAGE_CHIP_FG = "\x1b[38;5;255m";
const FILE_MENTION_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const EDITOR_THEME: EditorTheme = {
    borderColor: (text) => text,
    selectList: {
        selectedPrefix: (text) => text,
        selectedText: (text) => `${RIG_ORANGE}${text}${RESET}${INPUT_FG}`,
        description: (text) => `${DIM}${SURFACE_MUTED_FG}${text}${RESET}${INPUT_FG}`,
        scrollInfo: (text) => `${DIM}${SURFACE_MUTED_FG}${text}${RESET}${INPUT_FG}`,
        noMatch: (text) => `${SURFACE_MUTED_FG}${text}${RESET}${INPUT_FG}`,
    },
};

const MAX_TRANSCRIPT_ENTRIES = 500;

export interface CodingAssistantAppOptions {
    agent: CodingAssistantAgentBackend;
    cwd: string;
    initialMcpServers?: readonly McpServerSummary[];
    initialSessionEvents?: readonly SessionEvent[];
    initialSubagents?: readonly SubagentSummary[];
    initialTasks?: readonly SessionTask[];
    initialUserInputs?: readonly UserInputRequest[];
    modelLocked?: boolean;
    processManager: NativeProxessManager;
    sessionBacked?: boolean;
    tui: TUI;
    idFactory?: () => string;
    onDefaultModelChange?: (preference: DefaultModelPreference) => void | Promise<void>;
    onSettingsChange?: (settings: AppSettings) => void | Promise<void>;
    onExit?: () => void | Promise<void>;
    respondUserInput?: (requestId: string, response: UserInputResponse) => void | Promise<void>;
    now?: () => number;
    readClipboardImage?: (
        options?: ReadClipboardImageOptions,
    ) => Promise<ClipboardImage | undefined>;
    searchFiles?: (query: string) => Promise<readonly FileSearchResult[]>;
    showReasoning?: boolean;
    showUsage?: boolean;
    version?: string;
}

function addUsage(left: Usage, right: Usage): Usage {
    return {
        input: left.input + right.input,
        output: left.output + right.output,
        cacheRead: left.cacheRead + right.cacheRead,
        cacheWrite: left.cacheWrite + right.cacheWrite,
        totalTokens: left.totalTokens + right.totalTokens,
        cost: {
            input: left.cost.input + right.cost.input,
            output: left.cost.output + right.cost.output,
            cacheRead: left.cost.cacheRead + right.cost.cacheRead,
            cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
            total: left.cost.total + right.cost.total,
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
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}

function formatTokens(value: number): string {
    if (value < 1_000) return String(value);
    if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
    return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

export interface DefaultModelPreference {
    effort: string;
    modelId: string;
    providerId: string;
}

export interface AppSettings {
    showReasoning: boolean;
    showUsage: boolean;
}

interface PendingPrompt {
    content: string | readonly ContentBlock[];
    displayText: string;
    transcriptAppended?: boolean;
}

interface PastedImage {
    data: string;
    mediaType: string;
    path: string;
    placeholder: string;
}

interface PromptSubmission {
    content: string | readonly ContentBlock[];
    displayText: string;
    transcriptAppended?: boolean;
}

interface ActiveUserInput {
    answers: Record<string, readonly string[]>;
    questionIndex: number;
    request: UserInputRequest;
    selected: Set<string>;
}

interface FreeformUserInput {
    existingAnswers: readonly string[];
    questionId: string;
    requestId: string;
}

export class CodingAssistantApp implements Component, Focusable {
    readonly #agent: CodingAssistantAgentBackend;
    readonly #cwd: string;
    readonly #idFactory: () => string;
    readonly #now: () => number;
    readonly #editor: Editor;
    readonly #fileMentionAutocomplete: FileMentionAutocomplete | undefined;
    readonly #onDefaultModelChange:
        | ((preference: DefaultModelPreference) => void | Promise<void>)
        | undefined;
    readonly #onSettingsChange: ((settings: AppSettings) => void | Promise<void>) | undefined;
    readonly #onExit: (() => void | Promise<void>) | undefined;
    readonly #respondUserInput:
        | ((requestId: string, response: UserInputResponse) => void | Promise<void>)
        | undefined;
    readonly #processManager: NativeProxessManager;
    readonly #readClipboardImage: (
        options?: ReadClipboardImageOptions,
    ) => Promise<ClipboardImage | undefined>;
    readonly #tui: TUI;
    readonly #version: string;
    readonly #exitPromise: Promise<void>;

    #abortController: AbortController | undefined;
    #abortNotified = false;
    #activeRun: Promise<void> | undefined;
    #activeUserInput: ActiveUserInput | undefined;
    #answeringUserInputRequestId: string | undefined;
    #activityAnimationFrame = 0;
    #activityStartedAtMs: number | undefined;
    #activityAnimationTimer: ReturnType<typeof setInterval> | undefined;
    #cursorBlinkTimer: ReturnType<typeof setInterval> | undefined;
    #cursorTyping = false;
    #cursorTypingDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    #cursorVisible = true;
    #entries: AppTranscriptEntry[] = [];
    #showHeaderInFrame = true;
    #transcriptStartIndex = 0;
    #lastRenderedWidth = 80;
    #exiting = false;
    #exitResolve: (() => void) | undefined;
    #focused = false;
    #terminalFocused = true;
    #freeformUserInput: FreeformUserInput | undefined;
    #pendingPrompts: PendingPrompt[] = [];
    #compacting = false;
    #pastedImagesById = new Map<number, PastedImage>();
    #selectionPanel: Component | undefined;
    #dismissedSlashCommandText: string | undefined;
    #activeSubmission: Promise<void> | undefined;
    #bracketedPasteBuffer: string | undefined;
    #showReasoning: boolean;
    #showUsage: boolean;
    #sessionBacked: boolean;
    #modelLocked: boolean;
    #mcpServers: readonly McpServerSummary[];
    #slashCommandSelectionIndex = 0;
    readonly #slashCommands = createSlashCommands();
    #skillCommands: SlashCommandItem[] = [];
    #skillCommandsLoaded = false;
    #skillCommandsRefresh: Promise<void> | undefined;
    #skillsByName = new Map<string, Skill>();
    #imagePasteInFlight: Promise<void> | undefined;
    #nextPastedImageId = 1;
    #runToken = 0;
    #running = false;
    #seenToolCallIds = new Set<string>();
    #statusText = "Idle";
    #stopped = false;
    #streamEntryId: string | undefined;
    #subagents: readonly SubagentSummary[];
    #tasks: readonly SessionTask[];
    #thinkingEntryIdsByContentIndex = new Map<number, string>();
    #toolCallEntryIdsByContentIndex = new Map<number, string>();
    #runningToolCallIds = new Set<string>();
    #runningBackgroundProcesses = 0;
    #usage: Usage = zeroUsage();
    #latestContextTokens = 0;
    #userInputRequests: UserInputRequest[] = [];

    constructor(options: CodingAssistantAppOptions) {
        this.#agent = options.agent;
        this.#cwd = options.cwd;
        this.#idFactory = options.idFactory ?? createId;
        this.#now = options.now ?? Date.now;
        this.#onDefaultModelChange = options.onDefaultModelChange;
        this.#onSettingsChange = options.onSettingsChange;
        this.#onExit = options.onExit;
        this.#respondUserInput = options.respondUserInput;
        this.#processManager = options.processManager;
        this.#readClipboardImage = options.readClipboardImage ?? readClipboardImage;
        this.#sessionBacked = options.sessionBacked ?? false;
        this.#showReasoning = options.showReasoning ?? false;
        this.#showUsage = options.showUsage ?? false;
        this.#modelLocked = options.modelLocked ?? !options.agent.canChangeModel;
        this.#mcpServers = options.initialMcpServers ?? [];
        this.#subagents = options.initialSubagents ?? [];
        this.#tasks = options.initialTasks ?? [];
        this.#tui = options.tui;
        this.#version = options.version ?? "0.0.0";
        this.#editor = new Editor(this.#tui, EDITOR_THEME, { paddingX: 0 });
        this.#fileMentionAutocomplete =
            options.searchFiles === undefined
                ? undefined
                : new FileMentionAutocomplete(options.searchFiles, () => this.#requestRender());
        this.#exitPromise = new Promise((resolve) => {
            this.#exitResolve = resolve;
        });

        this.#editor.onSubmit = (value) => {
            this.#submit(value);
        };

        for (const request of options.initialUserInputs ?? []) {
            this.#enqueueUserInputRequest(request);
        }

        for (const event of options.initialSessionEvents ?? []) {
            this.applySessionEvent(event);
        }

        void this.#refreshSkillCommands();
    }

    get focused(): boolean {
        return this.#focused;
    }

    set focused(value: boolean) {
        this.#focused = value;
        this.#editor.focused = value && this.#terminalFocused;
        this.#cursorVisible = true;
        if (value && this.#terminalFocused) {
            this.#cursorTyping = false;
            this.#startCursorBlink();
        } else {
            this.#stopCursorBlink();
            if (!this.#terminalFocused) this.#cursorVisible = false;
        }
    }

    start(options: { tuiAlreadyStarted?: boolean } = {}): void {
        this.#tui.addChild(this);
        this.focused = true;
        this.#tui.setFocus(this);
        if (options.tuiAlreadyStarted !== true) {
            this.#tui.start();
        }
        this.#requestRender();
    }

    async stop(): Promise<void> {
        if (this.#stopped || this.#exiting) {
            return;
        }

        this.#exiting = true;
        this.#statusText = "Stopped";
        this.#abortController?.abort();
        this.#stopActivityAnimation();
        this.#stopCursorBlink();
        this.#fileMentionAutocomplete?.clear();
        this.#editor.setText("");
        this.#pastedImagesById.clear();
        this.#requestRender();
        await this.#waitForShutdownRender();

        this.#stopped = true;
        this.#tui.stop();

        try {
            await this.#processManager.killAll({ forceAfterMs: 500 });
            await this.#onExit?.();
        } finally {
            this.#exitResolve?.();
            this.#requestRender();
        }
    }

    waitForExit(): Promise<void> {
        return this.#exitPromise;
    }

    applySessionEvent(event: SessionEvent): void {
        if (event.type === "message_submitted") {
            this.#modelLocked = true;
            this.#appendEntry({ role: "user", text: event.data.displayText });
            return;
        }

        if (event.type === "run_started") {
            this.#running = true;
            this.#statusText = "Running";
            this.#activityStartedAtMs = this.#now();
            this.#startActivityAnimation();
            this.#requestRender();
            return;
        }

        if (event.type === "agent_event") {
            this.#applyAgentEvent(event.data.event);
            return;
        }

        if (event.type === "agent_message") {
            this.#applyAgentMessage(event.data.message);
            return;
        }

        if (event.type === "user_input_requested") {
            this.#enqueueUserInputRequest(event.data);
            return;
        }

        if (event.type === "user_input_resolved") {
            this.#removeUserInputRequest(event.data.requestId);
            return;
        }

        if (event.type === "mcp_servers_changed") {
            this.#mcpServers = event.data.servers;
            this.#requestRender();
            return;
        }

        if (event.type === "tasks_changed") {
            this.#tasks = event.data.tasks;
            this.#requestRender();
            return;
        }

        if (event.type === "subagent_changed") {
            this.#subagents = upsertSubagentSummary(this.#subagents, event.data.subagent);
            this.#requestRender();
            return;
        }

        if (event.type === "run_finished") {
            this.#running = false;
            this.#modelLocked = this.#pendingPrompts.length > 0;
            this.#statusText =
                event.data.stopReason === "stop" ? "Idle" : `Stopped: ${event.data.stopReason}`;
            this.#stopActivityAnimation();
            this.#streamEntryId = undefined;
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
            this.#runningToolCallIds.clear();
            this.#clearUserInputRequests();
            this.#requestRender();
            return;
        }

        if (event.type === "run_error") {
            this.#running = false;
            this.#modelLocked = this.#pendingPrompts.length > 0;
            this.#statusText = "Error";
            this.#stopActivityAnimation();
            this.#runningToolCallIds.clear();
            this.#clearUserInputRequests();
            this.#appendEntry({ role: "error", text: event.data.errorMessage });
            return;
        }

        if (event.type === "session_reset") {
            this.#clearEntries();
            this.#modelLocked = false;
            this.#seenToolCallIds.clear();
            this.#streamEntryId = undefined;
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
            this.#runningToolCallIds.clear();
            this.#usage = zeroUsage();
            this.#latestContextTokens = 0;
            this.#clearUserInputRequests();
            this.#appendEntry({
                role: "system",
                text: "Session reset. Started a new session.",
            });
            return;
        }

        if (event.type === "session_title_changed") {
            return;
        }

        if (event.type === "model_changed") {
            this.#appendEntry({
                role: "event",
                title: "model",
                text: `Model changed to ${this.#modelDisplayName()}.`,
            });
            return;
        }

        if (event.type === "effort_changed") {
            this.#appendEntry({
                role: "event",
                title: "reasoning",
                text: `Reasoning changed to ${humanizeReasoningLevel(event.data.effort ?? "off")}.`,
            });
            return;
        }

        if (event.type === "permission_mode_changed") {
            this.#appendEntry({
                role: "event",
                title: "permissions",
                text: `Permissions changed to ${humanizePermissionMode(event.data.permissionMode)}.`,
            });
            this.#requestRender();
            return;
        }
    }

    async waitForIdle(): Promise<void> {
        for (;;) {
            const activeSubmission = this.#activeSubmission;
            if (activeSubmission !== undefined) {
                await activeSubmission;
                continue;
            }

            const activeRun = this.#activeRun;
            if (activeRun === undefined) {
                return;
            }

            await activeRun;
        }
    }

    handleInput(data: string): void {
        if (this.#stopped || this.#exiting) {
            return;
        }

        if (data === TERMINAL_FOCUS_IN || data === TERMINAL_FOCUS_OUT) {
            this.#setTerminalFocused(data === TERMINAL_FOCUS_IN);
            return;
        }

        if (this.#selectionPanel !== undefined) {
            if (matchesKey(data, "ctrl+c") || data === "\x03") {
                this.#selectionPanel.handleInput?.("\x1b");
                this.#requestRender();
                return;
            }
            this.#selectionPanel.handleInput?.(data);
            this.#requestRender();
            return;
        }

        if (this.#freeformUserInput !== undefined) {
            if (this.#handlePastedInput(data)) return;
            if (matchesKey(data, "ctrl+c") || data === "\x03") {
                this.#handleCtrlC();
                return;
            }
            if (matchesKey(data, "ctrl+d") && this.#editor.getText().length === 0) {
                void this.stop();
                return;
            }
            if (matchesKey(data, "escape")) {
                this.#handleEscape();
                this.#requestRender();
                return;
            }
            this.#markTypingActivity();
            this.#editor.handleInput(data);
            this.#requestRender();
            return;
        }

        if (this.#handlePastedInput(data)) {
            return;
        }

        if (this.#handleImagePasteShortcut(data)) {
            return;
        }

        if (matchesKey(data, "ctrl+c") || data === "\x03") {
            this.#handleCtrlC();
            return;
        }

        if (matchesKey(data, "ctrl+d") && this.#editor.getText().length === 0) {
            void this.stop();
            return;
        }

        if (this.#running && matchesKey(data, "escape")) {
            this.#handleEscape();
            this.#requestRender();
            return;
        }

        const previousSlashCommandSuggestionCount = this.#slashCommandSuggestions().length;
        const previousFileMentionSuggestionCount = this.#fileMentionSnapshot()?.items.length ?? 0;
        if (this.#handleSlashCommandAutocompleteInput(data)) {
            const nextSlashCommandSuggestionCount = this.#slashCommandSuggestions().length;
            this.#requestRender(
                nextSlashCommandSuggestionCount < previousSlashCommandSuggestionCount,
            );
            return;
        }

        if (
            this.#running &&
            matchesKey(data, "tab") &&
            previousFileMentionSuggestionCount === 0 &&
            this.#queueCurrentInput()
        ) {
            return;
        }

        if (
            this.#fileMentionAutocomplete?.handleInput(
                data,
                this.#editor.getLines(),
                this.#editor.getCursor(),
                (path, context) => this.#completeFileMention(path, context),
            ) === true
        ) {
            const nextFileMentionSuggestionCount = this.#fileMentionSnapshot()?.items.length ?? 0;
            this.#requestRender(
                nextFileMentionSuggestionCount < previousFileMentionSuggestionCount,
            );
            return;
        }

        if (matchesKey(data, "escape")) {
            this.#markTypingActivity();
            this.#handleEscape();
            this.#requestRender();
            return;
        }

        if (this.#handleModelMenuShortcut(data)) {
            this.#requestRender();
            return;
        }

        if (this.#handleReasoningShortcut(data)) {
            this.#requestRender();
            return;
        }

        this.#markTypingActivity();
        this.#editor.handleInput(data);
        this.#syncAutocompleteState();
        const nextSlashCommandSuggestionCount = this.#slashCommandSuggestions().length;
        const nextFileMentionSuggestionCount = this.#fileMentionSnapshot()?.items.length ?? 0;
        this.#requestRender(
            nextSlashCommandSuggestionCount < previousSlashCommandSuggestionCount ||
                nextFileMentionSuggestionCount < previousFileMentionSuggestionCount,
        );
    }

    #handlePastedInput(data: string): boolean {
        if (this.#bracketedPasteBuffer !== undefined) {
            return this.#appendBracketedPaste(data);
        }

        const startIndex = data.indexOf(BRACKETED_PASTE_START);
        if (startIndex !== -1) {
            const beforePaste = data.slice(0, startIndex);
            if (beforePaste.length > 0) {
                this.#editor.handleInput(beforePaste);
            }

            const pastePayload = data.slice(startIndex + BRACKETED_PASTE_START.length);
            this.#appendBracketedPaste(pastePayload);
            return true;
        }

        if (this.#isPlainPastePayload(data)) {
            this.#insertPaste(data);
            return true;
        }

        return false;
    }

    #handleImagePasteShortcut(data: string): boolean {
        if (
            !matchesKey(data, "ctrl+v") &&
            !matchesKey(data, "alt+v") &&
            !matchesKey(data, "super+v") &&
            !IMAGE_PASTE_RAW_KEYS.has(data)
        ) {
            return false;
        }

        if (this.#imagePasteInFlight !== undefined) {
            return true;
        }

        const paste = this.#pasteClipboardImage().finally(() => {
            if (this.#imagePasteInFlight === paste) {
                this.#imagePasteInFlight = undefined;
            }
            this.#requestRender();
        });
        this.#imagePasteInFlight = paste;
        return true;
    }

    async #pasteClipboardImage(): Promise<void> {
        try {
            const image = await this.#readClipboardImage({
                outputDirectory: join(this.#cwd, ".context", "clipboard-images"),
            });
            if (image === undefined) {
                this.#appendEntry({
                    role: "event",
                    title: "clipboard",
                    text: "No image found in the clipboard.",
                });
                return;
            }

            this.#insertPastedImage(image);
        } catch (error) {
            this.#appendEntry({
                role: "error",
                title: "clipboard",
                text: `Image paste failed: ${this.#formatError(error)}`,
            });
        }
    }

    #insertPastedImage(image: ClipboardImage): void {
        const id = this.#nextPastedImageId++;
        const placeholder = `[Image #${id} ${this.#formatImageType(image.mediaType)}]`;
        this.#pastedImagesById.set(id, {
            data: image.data,
            mediaType: image.mediaType,
            path: image.path,
            placeholder,
        });

        const currentText = this.#editor.getText();
        const prefix = currentText.length > 0 && !/\s$/u.test(currentText) ? " " : "";
        this.#markTypingActivity();
        this.#editor.insertTextAtCursor(`${prefix}${placeholder} `);
        this.#syncAutocompleteState();
        this.#requestRender();
    }

    #appendBracketedPaste(data: string): boolean {
        const currentBuffer = this.#bracketedPasteBuffer ?? "";
        const nextBuffer = currentBuffer + data;
        const endIndex = nextBuffer.indexOf(BRACKETED_PASTE_END);

        if (endIndex === -1) {
            this.#bracketedPasteBuffer = nextBuffer;
            return true;
        }

        const pastedText = nextBuffer.slice(0, endIndex);
        const remaining = nextBuffer.slice(endIndex + BRACKETED_PASTE_END.length);
        this.#bracketedPasteBuffer = undefined;
        this.#insertPaste(pastedText);

        if (remaining.length > 0) {
            this.handleInput(remaining);
        }

        return true;
    }

    #insertPaste(text: string): void {
        if (text.length === 0) {
            this.#syncAutocompleteState();
            this.#requestRender();
            return;
        }

        this.#markTypingActivity();
        this.#editor.handleInput(`${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`);
        this.#syncAutocompleteState();
        this.#requestRender();
    }

    #isPlainPastePayload(data: string): boolean {
        return data.length > 1 && !data.includes("\x1b") && !matchesKey(data, "enter");
    }

    invalidate(): void {
        this.#editor.invalidate();
    }

    render(width: number): string[] {
        const safeWidth = Math.max(20, width);
        this.#lastRenderedWidth = safeWidth;
        const header = this.#showHeaderInFrame ? this.#renderHeader(safeWidth) : [];
        const slashCommandSuggestions = this.#slashCommandSuggestions();
        const fileMentionSnapshot =
            slashCommandSuggestions.length === 0 ? this.#fileMentionSnapshot() : undefined;
        const footer = this.#renderFooter(
            safeWidth,
            slashCommandSuggestions.length > 0
                ? slashCommandSuggestions
                : (fileMentionSnapshot?.items ?? []),
            slashCommandSuggestions.length > 0
                ? this.#slashCommandSelectionIndex
                : (fileMentionSnapshot?.selectedIndex ?? 0),
        );
        const input = this.#renderInput(safeWidth);

        if (this.#exiting) {
            return [...header, ...this.#renderTranscript(safeWidth)];
        }

        return [
            ...header,
            ...this.#renderTranscript(safeWidth),
            "",
            ...this.#renderQueuedPrompts(safeWidth),
            ...(this.#selectionPanel === undefined
                ? input
                : this.#selectionPanel.render(safeWidth)),
            "",
            ...footer,
            "",
            "",
        ];
    }

    prepareForTerminalResize(): { commit: () => void; lineCount: number } | undefined {
        const endIndex = this.#stableTranscriptEndIndex();
        if (endIndex <= this.#transcriptStartIndex && !this.#showHeaderInFrame) return undefined;

        const prefixEntries =
            this.#entries.length === 0 && this.#showHeaderInFrame
                ? [{ id: "ready", role: "system" as const, text: "Ready." }]
                : this.#visibleTranscriptEntries(this.#transcriptStartIndex, endIndex);
        const remainingEntries = this.#visibleTranscriptEntries(endIndex, this.#entries.length);
        const lineCount =
            (this.#showHeaderInFrame ? this.#renderHeader(this.#lastRenderedWidth).length : 0) +
            this.#renderTranscriptEntries(prefixEntries, this.#lastRenderedWidth).length +
            (prefixEntries.length > 0 && remainingEntries.length > 0 ? 1 : 0);
        if (lineCount === 0) return undefined;

        return {
            lineCount,
            commit: () => {
                this.#showHeaderInFrame = false;
                this.#transcriptStartIndex = endIndex;
            },
        };
    }

    #submit(value: string): void {
        if (this.#freeformUserInput !== undefined) {
            this.#submitFreeformUserInput(value);
            return;
        }
        const submission = this.#submitAsync(value).catch((error: unknown) => {
            this.#appendEntry({ role: "error", text: this.#formatError(error) });
        });
        const trackedSubmission = submission.finally(() => {
            if (this.#activeSubmission === trackedSubmission) {
                this.#activeSubmission = undefined;
            }
            this.#requestRender();
        });
        this.#activeSubmission = trackedSubmission;
    }

    async #submitAsync(value: string): Promise<void> {
        if (this.#compacting) {
            this.#appendEntry({
                role: "event",
                title: "compact",
                text: "Wait for conversation compaction to finish before submitting.",
            });
            return;
        }

        const submission = this.#createPromptSubmission(value);
        if (submission === undefined) {
            return;
        }
        const prompt = submission.displayText;

        this.#fileMentionAutocomplete?.clear();
        this.#editor.setText("");

        if (prompt.startsWith("/skill:")) {
            await this.#submitSkillCommand(prompt);
            this.#requestRender();
            return;
        }

        if (prompt === "/compact") {
            await this.#compactSession();
            this.#requestRender();
            return;
        }

        if (this.#handleCommand(prompt)) {
            this.#requestRender();
            return;
        }

        this.#modelLocked = true;
        if (this.#running) {
            await this.#agent.steer(submission.content, { displayText: submission.displayText });
            this.#clearSubmittedImages(prompt);
            if (!this.#sessionBacked) this.#appendEntry({ role: "user", text: prompt });
            this.#requestRender();
            return;
        }
        if (!this.#sessionBacked) {
            this.#appendEntry({ role: "user", text: prompt });
            submission.transcriptAppended = true;
        }
        this.#pendingPrompts.push(submission);
        this.#startDrainQueue();
        this.#requestRender();
    }

    #createPromptSubmission(value: string): PromptSubmission | undefined {
        const prompt = value.trim();
        if (prompt.length === 0) {
            return undefined;
        }

        const content = createCodeReviewPrompt(prompt) ?? this.#contentFromPrompt(prompt);
        return {
            content,
            displayText: prompt,
        };
    }

    #contentFromPrompt(prompt: string): string | readonly ContentBlock[] {
        const blocks: ContentBlock[] = [];
        let cursor = 0;
        let hasImage = false;

        for (const match of prompt.matchAll(IMAGE_PLACEHOLDER_REGEX)) {
            const rawMatch = match[0];
            const matchIndex = match.index;
            const imageId = Number(match[1]);
            const image = this.#pastedImagesById.get(imageId);
            if (image === undefined || image.placeholder !== rawMatch) {
                continue;
            }

            const text = prompt.slice(cursor, matchIndex);
            if (text.trim().length > 0) {
                blocks.push({ type: "text", text });
            }
            blocks.push({
                type: "image",
                data: image.data,
                mediaType: image.mediaType,
            });
            cursor = matchIndex + rawMatch.length;
            hasImage = true;
        }

        if (!hasImage) {
            return prompt;
        }

        const trailingText = prompt.slice(cursor);
        if (trailingText.trim().length > 0) {
            blocks.push({ type: "text", text: trailingText });
        }

        return blocks;
    }

    #clearSubmittedImages(prompt: string): void {
        for (const match of prompt.matchAll(IMAGE_PLACEHOLDER_REGEX)) {
            const imageId = Number(match[1]);
            const image = this.#pastedImagesById.get(imageId);
            if (image !== undefined && image.placeholder === match[0]) {
                this.#pastedImagesById.delete(imageId);
            }
        }
    }

    async #submitSkillCommand(prompt: string): Promise<void> {
        const parsed = /^\/skill:([a-z0-9-]+)(?:\s+([\s\S]*))?$/u.exec(prompt);
        if (parsed === null) {
            this.#appendEntry({
                role: "event",
                title: "skill",
                text: "Use /skill:<name> followed by optional instructions.",
            });
            return;
        }

        await this.#refreshSkillCommands({ force: true });
        const skillName = parsed[1];
        const skill = skillName === undefined ? undefined : this.#skillsByName.get(skillName);
        if (skill === undefined) {
            this.#appendEntry({
                role: "event",
                title: "skill",
                text: `Skill '${skillName ?? ""}' was not found.`,
            });
            return;
        }

        let content: string;
        try {
            content = await this.#agent.context.fs.readFile(skill.filePath);
        } catch (error) {
            this.#appendEntry({
                role: "error",
                title: "skill",
                text: this.#formatError(error),
            });
            return;
        }

        const expandedPrompt = formatSkillInvocation(
            skill,
            parseSkillFrontmatter(content).body,
            parsed[2] ?? "",
        );

        this.#modelLocked = true;
        if (this.#running) {
            await this.#agent.steer(expandedPrompt, { displayText: prompt });
            if (!this.#sessionBacked) this.#appendEntry({ role: "user", text: prompt });
            return;
        }
        if (!this.#sessionBacked) {
            this.#appendEntry({ role: "user", text: prompt });
        }
        if (this.#running && !this.#sessionBacked) {
            this.#appendEntry({
                role: "event",
                title: "queue",
                text: `Queued behind the active run.`,
            });
        }

        this.#pendingPrompts.push({ content: expandedPrompt, displayText: prompt });
        this.#startDrainQueue();
    }

    #handleCommand(prompt: string): boolean {
        if (prompt === "/goal" || prompt.startsWith("/goal ")) {
            void this.#handleGoalCommand(prompt).catch((error: unknown) => {
                this.#appendEntry({ role: "error", text: this.#formatError(error) });
                this.#requestRender();
            });
            return true;
        }

        if (prompt === "/model") {
            this.#openModelMenu();
            return true;
        }

        if (prompt === "/effort" || prompt === "/ford") {
            this.#openReasoningMenu({
                model: this.#agent.model,
                providerId: this.#agent.provider.id,
            });
            return true;
        }

        if (prompt === "/configure") {
            this.#openConfigureMenu();
            return true;
        }

        if (prompt === "/permissions" || prompt === "/permission") {
            this.#openPermissionsMenu();
            return true;
        }

        if (prompt === "/mcp") {
            this.#showMcpStatus();
            return true;
        }

        if (prompt === "/usage" || prompt === "/tokens") {
            this.#showUsageSummary();
            return true;
        }

        if (prompt === "/tasks" || prompt === "/todos") {
            this.#showTasks();
            return true;
        }

        if (prompt === "/agents") {
            this.#showSubagents();
            return true;
        }

        if (prompt === "/new") {
            this.#resetSession();
            return true;
        }

        if (prompt === "/exit") {
            void this.stop();
            return true;
        }

        if (prompt === "/clear") {
            this.#clearEntries();
            this.#streamEntryId = undefined;
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
            this.#appendEntry({ role: "system", text: "Transcript cleared." });
            return true;
        }

        if (prompt === "/abort") {
            if (!this.#abortActiveRun()) {
                this.#appendEntry({
                    role: "event",
                    title: "abort",
                    text: "No active run.",
                });
            }
            return true;
        }

        return false;
    }

    async #handleGoalCommand(prompt: string): Promise<void> {
        const argument = prompt.slice("/goal".length).trim();
        const goal = this.#agent.goal;

        if (argument.length === 0) {
            this.#appendEntry({
                role: "event",
                title: "goal",
                text:
                    goal === undefined
                        ? "No goal is set. Use /goal followed by an objective to start one."
                        : `Status: ${humanizeGoalStatus(goal.status)}\nObjective: ${goal.objective}\n\nCommands: /goal pause, /goal resume, /goal clear`,
            });
            return;
        }

        if (argument === "pause" || argument === "resume") {
            if (this.#agent.changeGoalStatus === undefined) {
                throw new Error("Goal controls are unavailable in this session.");
            }
            const status = argument === "pause" ? "paused" : "active";
            await this.#agent.changeGoalStatus(status);
            this.#appendEntry({
                role: "event",
                title: "goal",
                text: argument === "pause" ? "Goal paused." : "Goal resumed.",
            });
            return;
        }

        if (argument === "clear") {
            if (this.#agent.clearGoal === undefined) {
                throw new Error("Goal controls are unavailable in this session.");
            }
            await this.#agent.clearGoal();
            this.#appendEntry({ role: "event", title: "goal", text: "Goal cleared." });
            return;
        }

        if (this.#agent.setGoal === undefined) {
            throw new Error("Goal controls are unavailable in this session.");
        }
        await this.#agent.setGoal(argument);
        this.#appendEntry({
            role: "event",
            title: "goal",
            text: `Goal started: ${argument}`,
        });
    }

    #showMcpStatus(): void {
        if (this.#mcpServers.length === 0) {
            this.#appendEntry({
                role: "event",
                title: "MCP servers",
                text: "No MCP servers have connected in this session.",
            });
            return;
        }
        const text = this.#mcpServers
            .map((server) => {
                if (server.status === "connected") {
                    const capabilities = [
                        server.resourceSupport === true ? "resources" : undefined,
                        server.promptSupport === true ? "prompts" : undefined,
                    ].filter((value) => value !== undefined);
                    return `${server.name}: connected with ${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}${capabilities.length === 0 ? "" : `, ${capabilities.join(" and ")}`}`;
                }
                if (server.status === "disabled") return `${server.name}: disabled`;
                return `${server.name}: could not connect${server.errorMessage === undefined ? "" : ` — ${server.errorMessage}`}`;
            })
            .join("\n");
        this.#appendEntry({ role: "event", title: "MCP servers", text });
    }

    #showUsageSummary(): void {
        const contextWindow = this.#agent.model.contextWindow;
        const context =
            contextWindow === undefined
                ? `${formatTokens(this.#latestContextTokens)} tokens in the latest context`
                : `${formatTokens(this.#latestContextTokens)} of ${formatTokens(contextWindow)} context tokens (${Math.max(0, Math.round((1 - this.#latestContextTokens / contextWindow) * 100))}% left)`;
        this.#appendEntry({
            role: "event",
            title: "Token usage",
            text: [
                context,
                `Input: ${formatTokens(this.#usage.input)}`,
                `Output: ${formatTokens(this.#usage.output)}`,
                `Cache read: ${formatTokens(this.#usage.cacheRead)}`,
                `Cache write: ${formatTokens(this.#usage.cacheWrite)}`,
                `Total processed: ${formatTokens(this.#usage.totalTokens)}`,
            ].join("\n"),
        });
    }

    #showTasks(): void {
        if (this.#tasks.length === 0) {
            this.#appendEntry({
                role: "event",
                title: "Tasks",
                text: "No tasks are being tracked in this session.",
            });
            return;
        }
        const status = {
            completed: "Completed",
            in_progress: "In progress",
            pending: "Pending",
        } as const;
        this.#appendEntry({
            role: "event",
            title: "Tasks",
            text: this.#tasks
                .map((task) => `#${task.id} · ${status[task.status]} · ${task.subject}`)
                .join("\n"),
        });
    }

    #showSubagents(): void {
        if (this.#subagents.length === 0) {
            this.#appendEntry({
                role: "event",
                title: "Subagents",
                text: "No delegated work has been started in this session.",
            });
            return;
        }
        const labels = {
            aborted: "Stopped",
            completed: "Completed",
            error: "Failed",
            idle: "Idle",
            queued: "Queued",
            running: "Running",
        } as const;
        this.#appendEntry({
            role: "event",
            title: "Subagents",
            text: this.#subagents
                .map((subagent) => `${labels[subagent.status]} · ${subagent.description}`)
                .join("\n"),
        });
    }

    async #compactSession(): Promise<void> {
        if (this.#compacting || this.#running || this.#pendingPrompts.length > 0) {
            this.#appendEntry({
                role: "event",
                title: "compact",
                text: "Wait for the active response to finish before compacting.",
            });
            return;
        }

        this.#compacting = true;
        this.#statusText = "Compacting conversation";
        this.#requestRender();
        try {
            const result = await this.#agent.compact();
            this.#appendEntry({
                role: "event",
                title: "compact",
                text: result.compacted
                    ? `Compacted ${result.compactedMessageCount} older messages. The full transcript remains visible.`
                    : "There is not enough conversation history to compact yet.",
            });
        } finally {
            this.#compacting = false;
            this.#statusText = "Idle";
        }
    }

    #resetSession(): void {
        this.#abortActiveRun({ silent: true });
        this.#runToken += 1;
        this.#pendingPrompts = [];
        this.#pastedImagesById.clear();
        this.#clearEntries();
        this.#modelLocked = false;
        this.#seenToolCallIds.clear();
        this.#streamEntryId = undefined;
        this.#thinkingEntryIdsByContentIndex.clear();
        this.#toolCallEntryIdsByContentIndex.clear();
        this.#runningToolCallIds.clear();
        this.#usage = zeroUsage();
        this.#latestContextTokens = 0;
        this.#abortNotified = false;
        this.#statusText = "Idle";
        this.#agent.reset();
        this.#appendEntry({
            role: "system",
            text: "Session reset. Started a new session.",
        });
    }

    #startDrainQueue(): void {
        if (
            this.#activeRun !== undefined ||
            this.#compacting ||
            this.#pendingPrompts.length === 0
        ) {
            return;
        }

        this.#activeRun = this.#drainQueue().finally(() => {
            this.#activeRun = undefined;
            this.#startDrainQueue();
            this.#requestRender();
        });
    }

    async #drainQueue(): Promise<void> {
        while (!this.#stopped) {
            const prompt = this.#pendingPrompts.shift();
            if (prompt === undefined) {
                break;
            }

            await this.#runPrompt(prompt);
        }
    }

    async #runPrompt(prompt: PendingPrompt): Promise<void> {
        const controller = new AbortController();
        const runToken = ++this.#runToken;
        this.#abortController = controller;
        this.#abortNotified = false;
        this.#running = true;
        this.#statusText = "Running";
        this.#streamEntryId = undefined;
        this.#thinkingEntryIdsByContentIndex.clear();
        this.#toolCallEntryIdsByContentIndex.clear();
        this.#activityStartedAtMs = this.#now();
        this.#startActivityAnimation();
        this.#requestRender();
        this.#clearSubmittedImages(prompt.displayText);
        if (!this.#sessionBacked && prompt.transcriptAppended !== true) {
            this.#appendEntry({ role: "user", text: prompt.displayText });
        }

        try {
            await this.#refreshSkillCommands({ force: true });
            if (!this.#isCurrentRun(runToken)) {
                return;
            }

            const result = await this.#agent.send(prompt.content, {
                displayText: prompt.displayText,
                signal: controller.signal,
                ...(this.#sessionBacked
                    ? {}
                    : {
                          onEvent: (event) => this.#handleAgentEvent(event, runToken),
                          onMessage: (message) => this.#handleAgentMessage(message, runToken),
                      }),
            });
            if (!this.#isCurrentRun(runToken)) {
                return;
            }

            if (result.stopReason === "aborted") {
                this.#statusText = "Idle";
                this.#appendAbortNotice();
            } else {
                this.#statusText =
                    result.stopReason === "stop" ? "Idle" : `Stopped: ${result.stopReason}`;
            }
        } catch (error) {
            if (!this.#isCurrentRun(runToken)) {
                return;
            }
            if (controller.signal.aborted) {
                this.#statusText = "Idle";
                this.#appendAbortNotice();
            } else {
                this.#statusText = "Error";
                this.#appendEntry({ role: "error", text: this.#formatError(error) });
            }
        } finally {
            if (this.#isCurrentRun(runToken)) {
                if (this.#abortController === controller) {
                    this.#abortController = undefined;
                }
                this.#running = false;
                this.#stopActivityAnimation();
                this.#streamEntryId = undefined;
                this.#thinkingEntryIdsByContentIndex.clear();
                this.#toolCallEntryIdsByContentIndex.clear();
                this.#requestRender();
            }
        }
    }

    #handleEscape(): void {
        this.#restoreQueuedPromptsToComposer();
        this.#abortActiveRun();
    }

    #restoreQueuedPromptsToComposer(): void {
        if (this.#pendingPrompts.length === 0) return;
        const draft = this.#editor.getText().trim();
        const restored = this.#pendingPrompts.map((prompt) => prompt.displayText);
        if (draft.length > 0) restored.push(draft);
        this.#pendingPrompts = [];
        this.#editor.setText(restored.join("\n"));
        this.#syncAutocompleteState();
    }

    #abortActiveRun(options: { silent?: boolean } = {}): boolean {
        if (!this.#running || this.#abortController === undefined) {
            return false;
        }

        const controller = this.#abortController;
        this.#runToken += 1;
        controller.abort();
        this.#abortController = undefined;
        this.#running = false;
        this.#statusText = "Idle";
        this.#streamEntryId = undefined;
        this.#thinkingEntryIdsByContentIndex.clear();
        this.#toolCallEntryIdsByContentIndex.clear();
        this.#runningToolCallIds.clear();
        this.#stopActivityAnimation();
        void this.#processManager.killAll({ forceAfterMs: 500 }).catch((error: unknown) => {
            this.#appendEntry({ role: "error", text: this.#formatError(error) });
        });
        if (options.silent !== true) {
            this.#appendAbortNotice();
        }
        this.#requestRender();
        return true;
    }

    #isCurrentRun(runToken: number): boolean {
        return !this.#stopped && runToken === this.#runToken;
    }

    #handleAgentEvent(event: AgentLoopEvent, runToken: number): void {
        if (!this.#isCurrentRun(runToken)) {
            return;
        }

        this.#applyAgentEvent(event);
    }

    #applyAgentEvent(event: AgentLoopEvent): void {
        if (event.type === "inference_iteration_start") {
            this.#statusText = "Running";
            this.#streamEntryId = undefined;
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
            if (event.iteration > 1) {
                this.#appendEntry({ role: "separator", text: "" });
            }
        } else if (event.type === "text_start") {
            this.#statusText = "Running";
        } else if (event.type === "text_delta") {
            this.#appendStreamText(event.delta);
        } else if (event.type === "text_end") {
            this.#finishStreamText(event.content);
        } else if (event.type === "thinking_start") {
            this.#statusText = "Thinking";
        } else if (event.type === "thinking_delta") {
            this.#statusText = "Thinking";
            this.#appendThinkingText(event.contentIndex, event.delta);
        } else if (event.type === "thinking_end") {
            this.#statusText = "Thinking";
            this.#finishThinkingText(event.contentIndex, event.content);
        } else if (event.type === "toolcall_start") {
            this.#statusText = "Running";
            this.#ensureToolCallEntry(event.contentIndex);
        } else if (event.type === "toolcall_delta") {
            this.#statusText = "Running";
            this.#ensureToolCallEntry(event.contentIndex);
        } else if (event.type === "toolcall_end") {
            this.#finishToolCall(event.contentIndex, event.toolCall);
        } else if (event.type === "tool_execution_start") {
            this.#runningToolCallIds.add(event.toolCall.id);
            this.#statusText = `Running ${this.#runningToolCallIds.size} tool${this.#runningToolCallIds.size === 1 ? "" : "s"}`;
        } else if (event.type === "tool_execution_end") {
            this.#runningToolCallIds.delete(event.result.toolCallId);
            this.#finishToolResult(event.result);
            this.#statusText =
                this.#runningToolCallIds.size === 0
                    ? "Working"
                    : `Running ${this.#runningToolCallIds.size} tool${this.#runningToolCallIds.size === 1 ? "" : "s"}`;
        } else if (event.type === "tool_execution_progress") {
            const entry = this.#entries.find((candidate) => candidate.id === event.toolCallId);
            if (entry !== undefined) entry.detail = this.#singleLine(event.display);
        } else if (event.type === "permission_review") {
            const outcome =
                event.decision === "allow" ? "Approved automatically" : "Needs approval";
            this.#appendEntry({
                role: "event",
                title: "Auto permission",
                text: `${outcome}: ${event.action}. Risk: ${event.risk}. User authorization: ${event.userAuthorization}. ${event.reason}`,
            });
        } else if (event.type === "background_processes_changed") {
            this.#runningBackgroundProcesses = event.running;
        } else if (event.type === "done") {
            this.#statusText = event.reason === "toolUse" ? "Running tools" : "Idle";
        } else if (event.type === "error") {
            if (event.reason === "aborted") {
                this.#statusText = "Idle";
                this.#appendAbortNotice();
                return;
            }
            this.#statusText = "Error";
            this.#appendEntry({
                role: "error",
                text: event.error.errorMessage ?? "Provider returned an error.",
            });
        }

        this.#requestRender();
    }

    #appendAbortNotice(): void {
        if (this.#abortNotified) {
            return;
        }

        this.#abortNotified = true;
        this.#appendEntry({
            role: "error",
            title: "Session interrupted",
            text: "The active run was stopped.",
        });
    }

    #handleAgentMessage(message: Message, runToken: number): void {
        if (!this.#isCurrentRun(runToken) || message.role !== "agent") {
            return;
        }

        this.#applyAgentMessage(message);
    }

    #applyAgentMessage(message: Message): void {
        if (message.role !== "agent") {
            return;
        }
        if (message.usage !== undefined) {
            this.#usage = addUsage(this.#usage, message.usage);
            this.#latestContextTokens = message.usage.totalTokens;
        }

        let pendingText = "";
        let textSegment = 0;
        const flushText = () => {
            if (pendingText.length === 0) {
                return;
            }

            const id = textSegment === 0 ? message.id : `${message.id}:text:${textSegment}`;
            this.#finishAssistantMessage(id, pendingText);
            pendingText = "";
            textSegment += 1;
        };

        for (const [contentIndex, block] of message.blocks.entries()) {
            if (block.type === "text") {
                pendingText += block.text;
                continue;
            }

            flushText();

            if (block.type === "thinking") {
                this.#finishThinkingMessage(message.id, contentIndex, block.thinking);
            } else if (block.type === "tool_call" && !this.#seenToolCallIds.has(block.id)) {
                this.#seenToolCallIds.add(block.id);
                this.#appendEntry({
                    id: block.id,
                    role: "tool",
                    title: this.#toolDisplayName(block.name),
                    text: this.#formatToolCall(block.name, block.arguments),
                });
            } else if (block.type === "tool_result") {
                this.#finishToolResult(block);
            }
        }

        flushText();
        this.#requestRender();
    }

    #ensureStreamEntry(): AppTranscriptEntry {
        const existing =
            this.#streamEntryId === undefined
                ? undefined
                : this.#entries.find((entry) => entry.id === this.#streamEntryId);
        if (existing !== undefined) {
            return existing;
        }

        const entry = this.#appendEntry({ role: "assistant", text: "" });
        this.#streamEntryId = entry.id;
        return entry;
    }

    #appendStreamText(delta: string): void {
        const entry = this.#ensureStreamEntry();
        entry.text += delta;
    }

    #finishStreamText(text: string): void {
        const entry = this.#ensureStreamEntry();
        entry.text = text;
    }

    #ensureThinkingEntry(contentIndex: number): AppTranscriptEntry {
        const existingId = this.#thinkingEntryIdsByContentIndex.get(contentIndex);
        const existing =
            existingId === undefined
                ? undefined
                : this.#entries.find((entry) => entry.id === existingId);
        if (existing !== undefined) {
            return existing;
        }

        const entry = this.#appendEntry({ role: "thinking", text: "" });
        this.#thinkingEntryIdsByContentIndex.set(contentIndex, entry.id);
        return entry;
    }

    #appendThinkingText(contentIndex: number, delta: string): void {
        if (delta.length === 0) {
            return;
        }

        const entry = this.#ensureThinkingEntry(contentIndex);
        entry.text += delta;
    }

    #finishThinkingText(contentIndex: number, text: string): void {
        if (text.length === 0 && !this.#thinkingEntryIdsByContentIndex.has(contentIndex)) {
            return;
        }

        const entry = this.#ensureThinkingEntry(contentIndex);
        entry.text = text;
    }

    #ensureToolCallEntry(contentIndex: number): AppTranscriptEntry {
        const existingId = this.#toolCallEntryIdsByContentIndex.get(contentIndex);
        const existing =
            existingId === undefined
                ? undefined
                : this.#entries.find((entry) => entry.id === existingId);
        if (existing !== undefined) {
            return existing;
        }

        const entry = this.#appendEntry({
            role: "tool",
            title: PENDING_TOOL_CALL_TITLE,
            text: PENDING_TOOL_CALL_TITLE,
        });
        this.#toolCallEntryIdsByContentIndex.set(contentIndex, entry.id);
        return entry;
    }

    #finishToolCall(
        contentIndex: number,
        toolCall: {
            id: string;
            name: string;
            arguments: unknown;
        },
    ): void {
        this.#seenToolCallIds.add(toolCall.id);
        this.#statusText = `Calling ${this.#toolDisplayName(toolCall.name)}`;

        const existingId = this.#toolCallEntryIdsByContentIndex.get(contentIndex);
        const existing =
            existingId === undefined
                ? undefined
                : this.#entries.find((entry) => entry.id === existingId);

        if (existing !== undefined) {
            existing.id = toolCall.id;
            existing.title = this.#toolDisplayName(toolCall.name);
            existing.text = this.#formatToolCall(toolCall.name, toolCall.arguments);
            this.#toolCallEntryIdsByContentIndex.delete(contentIndex);
            return;
        }

        this.#toolCallEntryIdsByContentIndex.delete(contentIndex);
        this.#appendEntry({
            id: toolCall.id,
            role: "tool",
            title: this.#toolDisplayName(toolCall.name),
            text: this.#formatToolCall(toolCall.name, toolCall.arguments),
        });
    }

    #finishThinkingMessage(messageId: string, contentIndex: number, text: string): void {
        if (text.length === 0) {
            return;
        }

        const entry = this.#ensureThinkingEntry(contentIndex);
        entry.id = `${messageId}:thinking:${contentIndex}`;
        entry.text = text;
        this.#thinkingEntryIdsByContentIndex.set(contentIndex, entry.id);
    }

    #finishAssistantMessage(messageId: string, text: string): void {
        if (this.#streamEntryId !== undefined) {
            const entry = this.#entries.find((candidate) => candidate.id === this.#streamEntryId);
            if (entry !== undefined) {
                entry.id = messageId;
                entry.text = text;
                this.#streamEntryId = undefined;
                return;
            }
        }

        this.#appendEntry({ id: messageId, role: "assistant", text });
    }

    #appendEntry(entry: Omit<AppTranscriptEntry, "id"> & { id?: string }): AppTranscriptEntry {
        const completeEntry: AppTranscriptEntry = {
            id: entry.id ?? this.#idFactory(),
            role: entry.role,
            text: entry.text,
        };
        if (entry.detail !== undefined) {
            completeEntry.detail = entry.detail;
        }
        if (entry.title !== undefined) {
            completeEntry.title = entry.title;
        }

        this.#entries.push(completeEntry);
        if (this.#entries.length > MAX_TRANSCRIPT_ENTRIES) {
            const removedEntryCount = this.#entries.length - MAX_TRANSCRIPT_ENTRIES;
            this.#entries = this.#entries.slice(removedEntryCount);
            this.#transcriptStartIndex = Math.max(
                0,
                this.#transcriptStartIndex - removedEntryCount,
            );
        }
        this.#requestRender();
        return completeEntry;
    }

    #clearEntries(): void {
        this.#entries = [];
        this.#transcriptStartIndex = 0;
    }

    #renderHeader(width: number): string[] {
        return [
            ...this.#renderStartupBox(width, [
                `${RIG_ORANGE}>_${RESET} ${BOLD}Rig${NOT_BOLD_OR_DIM} ${this.#version}`,
                "Agentic coding CLI for local project work.",
                "Keeps sessions in a private local daemon.",
                `Directory: ${this.#directoryName()}`,
            ]),
            "",
        ];
    }

    #renderTranscript(width: number): string[] {
        const sourceEntries =
            this.#entries.length === 0 && this.#showHeaderInFrame
                ? [{ id: "ready", role: "system" as const, text: "Ready." }]
                : this.#entries.slice(this.#transcriptStartIndex);
        const entries = this.#showReasoning
            ? sourceEntries
            : sourceEntries.filter((entry) => entry.role !== "thinking");
        const lines = this.#renderTranscriptEntries(entries, width);

        const activityLabel = this.#activityLabel();
        if (activityLabel !== undefined && this.#shouldRenderActivityAsLastMessage()) {
            if (lines.length > 0) {
                lines.push("");
            }
            lines.push(...this.#renderActivityLine(activityLabel, width));
        }

        return lines;
    }

    #renderTranscriptEntries(entries: readonly AppTranscriptEntry[], width: number): string[] {
        const lines: string[] = [];
        for (const entry of entries) {
            if (lines.length > 0) lines.push("");
            lines.push(...this.#renderEntry(entry, width));
        }
        return lines;
    }

    #visibleTranscriptEntries(startIndex: number, endIndex: number): AppTranscriptEntry[] {
        const entries = this.#entries.slice(startIndex, endIndex);
        return this.#showReasoning ? entries : entries.filter((entry) => entry.role !== "thinking");
    }

    #stableTranscriptEndIndex(): number {
        if (!this.#running) return this.#entries.length;

        const mutableEntryIds = new Set<string>();
        if (this.#streamEntryId !== undefined) mutableEntryIds.add(this.#streamEntryId);
        const latestThinkingIndex = Math.max(-1, ...this.#thinkingEntryIdsByContentIndex.keys());
        const latestThinkingEntryId = this.#thinkingEntryIdsByContentIndex.get(latestThinkingIndex);
        if (latestThinkingEntryId !== undefined) {
            mutableEntryIds.add(latestThinkingEntryId);
        }
        for (const entryId of this.#toolCallEntryIdsByContentIndex.values()) {
            mutableEntryIds.add(entryId);
        }
        for (const entryId of this.#runningToolCallIds) mutableEntryIds.add(entryId);

        let endIndex = this.#entries.length;
        for (let index = this.#transcriptStartIndex; index < this.#entries.length; index += 1) {
            const entry = this.#entries[index];
            if (entry !== undefined && mutableEntryIds.has(entry.id)) {
                endIndex = index;
                break;
            }
        }
        return endIndex;
    }

    #renderEntry(entry: AppTranscriptEntry, width: number): string[] {
        if (entry.role === "separator") {
            return [this.#turnSeparator(width)];
        }
        if (entry.role === "user") {
            return this.#renderUserEntry(entry, width);
        }
        if (entry.role === "assistant") {
            return this.#renderAssistantEntry(entry, width);
        }
        if (entry.role === "thinking") {
            return this.#renderThinkingEntry(entry, width);
        }
        if (entry.role === "tool") {
            return this.#renderToolEntry(entry, width, false);
        }
        if (entry.role === "error") {
            return entry.detail === undefined
                ? this.#renderNoticeEntry(entry.title ?? "Error", entry.text, width, RED)
                : this.#renderToolEntry(entry, width, true);
        }
        if (entry.role === "event") {
            return this.#renderNoticeEntry(entry.title ?? "event", entry.text, width, YELLOW);
        }

        return this.#renderNoticeEntry("system", entry.text, width, SURFACE_MUTED_FG);
    }

    #renderFooter(
        width: number,
        suggestions: readonly AutocompleteItem[],
        selectedIndex: number,
    ): string[] {
        if (suggestions.length > 0) {
            return this.#renderAutocomplete(width, suggestions, selectedIndex);
        }

        const parts = [`${FOOTER_MODEL_FG}${this.#modelWithReasoningDisplayName()}${RESET}`];
        if (this.#running) {
            parts.push(`${FOOTER_QUEUED_FG}Enter steers · Tab queues${RESET}`);
        }
        parts.push(`${FOOTER_CWD_FG}${this.#cwdDisplayName()}${RESET}`);
        if (this.#pendingPrompts.length > 0) {
            parts.push(`${FOOTER_QUEUED_FG}queued ${this.#pendingPrompts.length}${RESET}`);
        }
        if (this.#showUsage) parts.push(`${FOOTER_CWD_FG}${this.#usageFooter()}${RESET}`);
        const runningAgents = this.#subagents.filter(
            (subagent) => subagent.status === "running",
        ).length;
        if (runningAgents > 0) {
            parts.push(
                `${FOOTER_QUEUED_FG}${runningAgents} agent${runningAgents === 1 ? "" : "s"}${RESET}`,
            );
        }
        if (this.#runningBackgroundProcesses > 0) {
            parts.push(
                `${FOOTER_QUEUED_FG}${this.#runningBackgroundProcesses} process${this.#runningBackgroundProcesses === 1 ? "" : "es"}${RESET}`,
            );
        }

        const line = `${" ".repeat(visibleWidth(INPUT_PROMPT))}${parts.join(`${DIM} • ${RESET}`)}`;
        return [this.#fitLine(line, width)];
    }

    #usageFooter(): string {
        const window = this.#agent.model.contextWindow;
        if (window === undefined) return `${formatTokens(this.#latestContextTokens)} tokens`;
        const percentLeft = Math.max(0, Math.round((1 - this.#latestContextTokens / window) * 100));
        return `${formatTokens(this.#latestContextTokens)} tokens · ${percentLeft}% left`;
    }

    #renderQueuedPrompts(width: number): string[] {
        return this.#pendingPrompts.flatMap((prompt) => {
            const prefix = `${DIM}↳ queued${RESET} `;
            const prefixWidth = visibleWidth(prefix);
            const wrapped = wrapTextWithAnsi(
                prompt.displayText,
                Math.max(1, width - prefixWidth),
            ).slice(0, 3);
            const indent = " ".repeat(prefixWidth);
            return wrapped.map((line, index) =>
                this.#fitLine(`${index === 0 ? prefix : indent}${DIM}${line}${RESET}`, width),
            );
        });
    }

    #renderAutocomplete(
        width: number,
        suggestions: readonly AutocompleteItem[],
        selectedIndex: number,
        maxVisible = AUTOCOMPLETE_MAX_VISIBLE,
    ): string[] {
        const rowWidth = Math.max(1, width - 1);
        const visibleCount = Math.max(1, Math.min(maxVisible, AUTOCOMPLETE_MAX_VISIBLE));
        const safeSelectedIndex = Math.min(selectedIndex, suggestions.length - 1);
        const startIndex = Math.max(
            0,
            Math.min(
                safeSelectedIndex - Math.floor(visibleCount / 2),
                suggestions.length - visibleCount,
            ),
        );
        const visibleSuggestions = suggestions.slice(startIndex, startIndex + visibleCount);
        const labelWidth = Math.max(
            8,
            ...visibleSuggestions.map((item) => visibleWidth(this.#singleLine(item.label)) + 2),
        );
        const labelColumnWidth = Math.min(labelWidth, Math.max(1, rowWidth - 2));

        return visibleSuggestions.map((item, index) => {
            const absoluteIndex = startIndex + index;
            const isSelected = absoluteIndex === safeSelectedIndex;
            const marker = isSelected ? "→ " : "  ";
            const label = this.#fitAndPadLine(this.#singleLine(item.label), labelColumnWidth);
            const remainingWidth = Math.max(
                0,
                rowWidth - visibleWidth(marker) - visibleWidth(label),
            );
            const description = truncateToWidth(
                this.#singleLine(item.description ?? ""),
                remainingWidth,
                "",
                false,
            );
            const line = isSelected
                ? `${RIG_ORANGE}${marker}${label}${description}${RESET}`
                : `${marker}${label}${DIM}${SURFACE_MUTED_FG}${description}${RESET}`;
            return this.#fitLine(line, rowWidth);
        });
    }

    #openModelMenu(): void {
        if (this.#exiting || this.#stopped) {
            return;
        }

        const selectedModelId = this.#agent.model.id;
        const selectedProviderId = this.#agent.provider.id;
        const selectedValue = encodeModelChoice(selectedProviderId, selectedModelId);
        const choices = this.#modelChoices();
        const panel = createSelectionPanel({
            title: "Choose Model",
            subtitle: this.#modelLocked
                ? "Wait for the active response to finish"
                : "Enter selects, Esc cancels",
            selectedValue,
            items: choices.map((choice) => ({
                value: encodeModelChoice(choice.providerId, choice.model.id),
                label: choice.model.name,
                description: describeModelChoice(
                    choice.model,
                    choice.providerId,
                    choice.model.id === selectedModelId && choice.providerId === selectedProviderId,
                    {
                        locked:
                            this.#modelLocked &&
                            (choice.model.id !== selectedModelId ||
                                choice.providerId !== selectedProviderId),
                    },
                ),
            })),
            onSelect: (item) => {
                const choice = choices.find(
                    (candidate) =>
                        encodeModelChoice(candidate.providerId, candidate.model.id) === item.value,
                );
                if (choice === undefined) {
                    this.#closeSelectionPanel();
                    return;
                }
                if (this.#modelLocked && item.value !== selectedValue) {
                    this.#appendEntry({
                        role: "event",
                        title: "model",
                        text: "Wait for the active response to finish before changing models.",
                    });
                    this.#closeSelectionPanel();
                    this.#requestRender();
                    return;
                }

                this.#closeSelectionPanel();
                this.#openReasoningMenu(choice);
            },
            onCancel: () => {
                this.#closeSelectionPanel();
            },
        });
        this.#showSelectionPanel(panel);
    }

    #openReasoningMenu(choice: CodingAssistantModelChoice): void {
        const { model, providerId } = choice;

        const currentEffort = this.#agent.snapshot().effort;
        const defaultEffort = model.defaultThinkingLevel;
        const isCurrent =
            model.id === this.#agent.model.id && providerId === this.#agent.provider.id;
        const selectedEffort =
            isCurrent && currentEffort !== undefined && model.thinkingLevels.includes(currentEffort)
                ? currentEffort
                : defaultEffort;
        const panel = createSelectionPanel({
            title: "Choose Reasoning",
            subtitle: model.name,
            selectedValue: selectedEffort,
            items: model.thinkingLevels.map((level) => ({
                value: level,
                label: humanizeReasoningLevel(level),
                description: describeReasoningLevel(level, {
                    isCurrent: isCurrent && level === currentEffort,
                    isDefault: level === defaultEffort,
                }),
            })),
            onSelect: (item) => {
                if (this.#modelLocked || isCurrent) {
                    this.#agent.setEffort(item.value);
                    if (!this.#sessionBacked) {
                        this.#appendEntry({
                            role: "event",
                            title: "reasoning",
                            text: `Reasoning changed to ${humanizeReasoningLevel(item.value)}.`,
                        });
                    }
                } else {
                    this.#agent.setModel(model.id, item.value, providerId);
                    this.#persistDefaultModel(model.id, item.value, providerId);
                    if (!this.#sessionBacked) {
                        this.#appendEntry({
                            role: "event",
                            title: "model",
                            text: `Model changed to ${model.name} with ${humanizeReasoningLevel(item.value)} reasoning.`,
                        });
                    }
                }
                this.#closeSelectionPanel();
                this.#requestRender();
            },
            onCancel: () => {
                this.#closeSelectionPanel();
            },
        });
        this.#showSelectionPanel(panel);
    }

    #openConfigureMenu(): void {
        if (this.#exiting || this.#stopped) {
            return;
        }

        const panel = createSelectionPanel({
            title: "Configure",
            subtitle: "App settings",
            items: [
                {
                    value: "reasoning",
                    label: this.#showReasoning ? "Hide reasoning" : "Show reasoning",
                    description: "Toggle reasoning blocks in the transcript.",
                },
                {
                    value: "usage",
                    label: this.#showUsage ? "Hide token status" : "Show token status",
                    description: "Toggle context usage below the input.",
                },
            ],
            onSelect: (item) => {
                if (item.value === "reasoning") this.#showReasoning = !this.#showReasoning;
                if (item.value === "usage") this.#showUsage = !this.#showUsage;
                this.#persistSettings();
                this.#closeSelectionPanel();
                this.#appendEntry({
                    role: "event",
                    title: "settings",
                    text:
                        item.value === "reasoning"
                            ? `Reasoning display ${this.#showReasoning ? "enabled" : "disabled"}.`
                            : `Token status ${this.#showUsage ? "enabled" : "disabled"}.`,
                });
                this.#requestRender();
            },
            onCancel: () => {
                this.#closeSelectionPanel();
            },
        });
        this.#showSelectionPanel(panel);
    }

    #openPermissionsMenu(): void {
        const panel = createSelectionPanel({
            title: "Choose Permissions",
            subtitle: "Applies to this session and its subagents",
            selectedValue: this.#agent.permissionMode,
            items: [
                {
                    value: "auto",
                    label: "Auto",
                    description: "Automatically review risky actions; ask only when needed.",
                },
                {
                    value: "workspace_write",
                    label: "Workspace write",
                    description: "Write in the workspace; block shell network access.",
                },
                {
                    value: "read_only",
                    label: "Read only",
                    description: "Keep project files read only; allow temporary files.",
                },
                {
                    value: "full_access",
                    label: "Full access",
                    description: "Allow unrestricted filesystem, shell, and network access.",
                },
            ],
            onSelect: (item) => {
                const mode = item.value as "auto" | "workspace_write" | "read_only" | "full_access";
                this.#agent.setPermissionMode(mode);
                if (!this.#sessionBacked) {
                    this.#appendEntry({
                        role: "event",
                        title: "permissions",
                        text: `Permissions changed to ${humanizePermissionMode(mode)}.`,
                    });
                }
                this.#closeSelectionPanel();
                this.#requestRender();
            },
            onCancel: () => this.#closeSelectionPanel(),
        });
        this.#showSelectionPanel(panel);
    }

    #enqueueUserInputRequest(request: UserInputRequest): void {
        if (
            this.#userInputRequests.some((candidate) => candidate.requestId === request.requestId)
        ) {
            return;
        }
        this.#userInputRequests.push(request);
        this.#openNextUserInputRequest();
    }

    #openNextUserInputRequest(): void {
        if (
            this.#activeUserInput !== undefined ||
            this.#answeringUserInputRequestId !== undefined ||
            this.#freeformUserInput !== undefined
        ) {
            return;
        }
        const request = this.#userInputRequests[0];
        if (request === undefined) return;
        this.#activeUserInput = {
            answers: {},
            questionIndex: 0,
            request,
            selected: new Set(),
        };
        this.#openUserInputQuestion();
    }

    #openUserInputQuestion(): void {
        const active = this.#activeUserInput;
        const question = active?.request.questions[active.questionIndex];
        if (active === undefined || question === undefined) return;

        const items = question.options.map((option, index) => ({
            value: `option:${index}`,
            label: active.selected.has(option.label) ? `✓ ${option.label}` : option.label,
            description: option.description,
        }));
        if (question.multiSelect && active.selected.size > 0) {
            items.push({
                value: "done",
                label: "Done",
                description: `Submit ${active.selected.size} selected answer${active.selected.size === 1 ? "" : "s"}.`,
            });
        }
        items.push({
            value: "other",
            label: "Type another answer",
            description: "Enter a response that is not listed.",
        });

        this.#showSelectionPanel(
            createSelectionPanel({
                title: question.header,
                subtitle: `${question.question} · ${active.questionIndex + 1} of ${active.request.questions.length}`,
                items,
                onSelect: (item) => {
                    if (item.value === "other") {
                        this.#freeformUserInput = {
                            existingAnswers: [...active.selected],
                            questionId: question.id,
                            requestId: active.request.requestId,
                        };
                        this.#closeSelectionPanel();
                        this.#editor.setText("");
                        this.#requestRender();
                        return;
                    }
                    if (item.value === "done") {
                        this.#commitUserInputAnswer([...active.selected]);
                        return;
                    }

                    const optionIndex = Number.parseInt(item.value.slice("option:".length), 10);
                    const option = question.options[optionIndex];
                    if (option === undefined) return;
                    if (!question.multiSelect) {
                        this.#commitUserInputAnswer([option.label]);
                        return;
                    }
                    if (active.selected.has(option.label)) active.selected.delete(option.label);
                    else active.selected.add(option.label);
                    this.#openUserInputQuestion();
                    this.#requestRender();
                },
                onCancel: () => {
                    this.#closeSelectionPanel();
                    this.#handleEscape();
                },
            }),
        );
        this.#requestRender();
    }

    #commitUserInputAnswer(answers: readonly string[]): void {
        const active = this.#activeUserInput;
        const question = active?.request.questions[active.questionIndex];
        if (active === undefined || question === undefined || answers.length === 0) return;

        active.answers[question.id] = [...answers];
        active.questionIndex += 1;
        active.selected = new Set();
        if (active.questionIndex < active.request.questions.length) {
            this.#openUserInputQuestion();
            return;
        }
        this.#sendUserInputResponse(active.request, { answers: active.answers });
    }

    #submitFreeformUserInput(value: string): void {
        const answer = value.trim();
        const freeform = this.#freeformUserInput;
        const active = this.#activeUserInput;
        if (answer.length === 0 || freeform === undefined || active === undefined) return;
        if (active.request.requestId !== freeform.requestId) return;
        if (active.request.questions[active.questionIndex]?.id !== freeform.questionId) return;

        this.#freeformUserInput = undefined;
        this.#editor.setText("");
        this.#commitUserInputAnswer([...freeform.existingAnswers, answer]);
        this.#requestRender();
    }

    #sendUserInputResponse(request: UserInputRequest, response: UserInputResponse): void {
        this.#activeUserInput = undefined;
        this.#closeSelectionPanel();
        if (this.#respondUserInput === undefined) {
            this.#appendEntry({
                role: "error",
                text: "This client cannot send interactive answers.",
            });
            this.#removeUserInputRequest(request.requestId);
            this.#handleEscape();
            return;
        }

        this.#answeringUserInputRequestId = request.requestId;
        void Promise.resolve(this.#respondUserInput(request.requestId, response))
            .then(() => this.#removeUserInputRequest(request.requestId))
            .catch((error: unknown) => {
                this.#answeringUserInputRequestId = undefined;
                this.#appendEntry({
                    role: "error",
                    text: `The answer could not be sent: ${this.#formatError(error)}`,
                });
                this.#openNextUserInputRequest();
                this.#requestRender();
            });
    }

    #removeUserInputRequest(requestId: string): void {
        const wasActive = this.#activeUserInput?.request.requestId === requestId;
        const wasFreeform = this.#freeformUserInput?.requestId === requestId;
        this.#userInputRequests = this.#userInputRequests.filter(
            (request) => request.requestId !== requestId,
        );
        if (wasActive) this.#activeUserInput = undefined;
        if (wasFreeform) {
            this.#freeformUserInput = undefined;
            this.#editor.setText("");
        }
        if (this.#answeringUserInputRequestId === requestId) {
            this.#answeringUserInputRequestId = undefined;
        }
        if (wasActive || wasFreeform) this.#closeSelectionPanel();
        this.#openNextUserInputRequest();
        this.#requestRender();
    }

    #clearUserInputRequests(): void {
        const hadVisibleRequest =
            this.#activeUserInput !== undefined || this.#freeformUserInput !== undefined;
        this.#userInputRequests = [];
        this.#activeUserInput = undefined;
        this.#answeringUserInputRequestId = undefined;
        if (this.#freeformUserInput !== undefined) this.#editor.setText("");
        this.#freeformUserInput = undefined;
        if (hadVisibleRequest) this.#closeSelectionPanel();
    }

    #showSelectionPanel(component: Component): void {
        this.#selectionPanel = component;
    }

    #closeSelectionPanel(): void {
        this.#selectionPanel = undefined;
    }

    #renderInput(width: number): string[] {
        return [
            this.#surfaceLine("", width),
            ...this.#renderInputContent(width),
            this.#surfaceLine("", width),
        ];
    }

    #renderInputContent(width: number): string[] {
        if (this.#editor.getText().length === 0) {
            return [this.#inputSurfaceLine(this.#emptyInputLine(), width)];
        }

        const promptWidth = visibleWidth(INPUT_PROMPT);
        const editorWidth = Math.max(1, width - promptWidth);
        const contentLines = this.#stripSpuriousLeadingEmptyLine(
            this.#stripEditorChrome(this.#editor.render(editorWidth)),
        );

        return contentLines.map((line, index) => {
            if (this.#isEditorScrollIndicator(line)) {
                return this.#inputSurfaceLine(`${INPUT_LINE_INDENT}${DIM}${line}${RESET}`, width);
            }
            const prefix = index === 0 ? this.#inputPrompt() : INPUT_LINE_INDENT;
            const rendered = `${prefix}${this.#styleImagePlaceholders(line)}`;
            return this.#inputSurfaceLine(
                this.#cursorVisible ? rendered : this.#hideCursor(rendered),
                width,
            );
        });
    }

    #finishToolResult(
        block: Pick<ToolResultBlock, "display" | "isError" | "toolCallId" | "toolName">,
    ): void {
        const existing = this.#entries.find((entry) => entry.id === block.toolCallId);
        const detail = this.#formatToolResult(block);
        if (existing !== undefined) {
            existing.role = block.isError ? "error" : "tool";
            existing.title = this.#toolDisplayName(block.toolName);
            existing.detail = detail;
            return;
        }

        this.#appendEntry({
            id: block.toolCallId,
            role: block.isError ? "error" : "tool",
            title: this.#toolDisplayName(block.toolName),
            text: this.#toolDisplayName(block.toolName),
            detail,
        });
    }

    #formatToolCall(toolName: string, args: unknown): string {
        const record = this.#isRecord(args) ? args : {};
        const stringField = (key: string): string | undefined => {
            const value = record[key];
            return typeof value === "string" && value.length > 0 ? value : undefined;
        };

        const normalized = toolName.toLowerCase();
        if (normalized === "request_user_input" || normalized === "askuserquestion") {
            const questions = record.questions;
            const firstQuestion = Array.isArray(questions) ? questions[0] : undefined;
            if (this.#isRecord(firstQuestion) && typeof firstQuestion.question === "string") {
                return this.#singleLine(firstQuestion.question);
            }
            return "Waiting for your answer";
        }
        const command = stringField("cmd") ?? stringField("command");
        if (command !== undefined) {
            return this.#singleLine(command);
        }

        const path = stringField("file_path") ?? stringField("path");
        if (path !== undefined) {
            return this.#singleLine(path);
        }

        const pattern = stringField("pattern");
        if (pattern !== undefined) {
            return this.#singleLine(pattern);
        }

        const query = stringField("query");
        if (query !== undefined) {
            return this.#singleLine(query);
        }

        if (normalized === "todowrite") {
            const todos = record.todos;
            return Array.isArray(todos)
                ? `${todos.length} todo${todos.length === 1 ? "" : "s"}`
                : "todos";
        }

        if (normalized === "taskcreate") {
            return stringField("subject") ?? "Create task";
        }
        if (normalized === "taskget") {
            const taskId = stringField("taskId");
            return taskId === undefined ? "Read task" : `Read task ${taskId}`;
        }
        if (normalized === "taskupdate") {
            const taskId = stringField("taskId");
            return taskId === undefined ? "Update task" : `Update task ${taskId}`;
        }
        if (normalized === "tasklist") return "Current tasks";
        if (normalized === "agent") {
            return stringField("description") ?? "Delegated work";
        }
        if (normalized === "spawn_agent") {
            const taskName = stringField("task_name");
            return taskName === undefined
                ? "Start delegated work"
                : taskName
                      .replaceAll("_", " ")
                      .replace(/^./u, (character) => character.toUpperCase());
        }
        if (normalized === "followup_task" || normalized === "sendmessage") {
            return stringField("summary") ?? "Send follow-up work";
        }
        if (normalized === "wait_agent") return "Wait for delegated work";
        if (normalized === "list_agents") return "Show delegated work";
        if (normalized === "interrupt_agent") return "Stop delegated work";

        return this.#toolDisplayName(toolName);
    }

    #toolDisplayName(toolName: string): string {
        return humanizeToolName(toolName);
    }

    #formatToolResult(block: Pick<ToolResultBlock, "display">): string {
        return this.#singleLine(block.display.length > 0 ? block.display : "(empty result)");
    }

    #formatError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        return String(error);
    }

    #formatImageType(mediaType: string): string {
        const subtype = mediaType.split("/")[1]?.split(";")[0]?.trim();
        if (subtype === undefined || subtype.length === 0) {
            return "IMAGE";
        }

        const upperSubtype = subtype.toUpperCase();
        return upperSubtype === "JPEG" ? "JPG" : upperSubtype;
    }

    #styleImagePlaceholders(text: string): string {
        return text.replace(
            IMAGE_PLACEHOLDER_REGEX,
            (placeholder) =>
                `${IMAGE_CHIP_BG}${IMAGE_CHIP_FG}${placeholder}${SURFACE_BG}${INPUT_FG}`,
        );
    }

    #fitLine(line: string, width: number): string {
        return truncateToWidth(line, width, "", true);
    }

    #truncateLine(line: string, width: number): string {
        return truncateToWidth(line, width, "", false);
    }

    #renderStartupBox(width: number, rows: string[]): string[] {
        const maxInnerWidth = Math.max(1, width - 4);
        const contentWidth = rows
            .map((row) => visibleWidth(row))
            .reduce((maxWidth, rowWidth) => Math.max(maxWidth, rowWidth), 1);
        const innerWidth = Math.min(maxInnerWidth, contentWidth);
        const rule = "─".repeat(innerWidth + 2);
        const top = `╭${rule}╮`;
        const bottom = `╰${rule}╯`;
        return [
            this.#truncateLine(`${DIM}${top}${RESET}`, width),
            ...rows.map((row) => {
                const paddedText = this.#fitAndPadLine(row, innerWidth);
                return this.#truncateLine(
                    `${DIM}│ ${NOT_BOLD_OR_DIM}${paddedText}${DIM} │${RESET}`,
                    width,
                );
            }),
            this.#truncateLine(`${DIM}${bottom}${RESET}`, width),
        ];
    }

    #renderUserEntry(entry: AppTranscriptEntry, width: number): string[] {
        const prefix = `${BOLD}›${NOT_BOLD_OR_DIM} `;
        const prefixWidth = visibleWidth(prefix);
        const contentWidth = Math.max(1, width - prefixWidth);
        const text = this.#styleImagePlaceholders(entry.text.length === 0 ? " " : entry.text);
        const wrapped = wrapTextWithAnsi(text, contentWidth);
        const indent = " ".repeat(prefixWidth);
        return [
            this.#surfaceLine("", width),
            ...wrapped.map((line, index) =>
                this.#inputSurfaceLine(`${index === 0 ? prefix : indent}${line}`, width),
            ),
            this.#surfaceLine("", width),
        ];
    }

    #renderAssistantEntry(entry: AppTranscriptEntry, width: number): string[] {
        const prefix = `${DIM}•${RESET} `;
        const prefixWidth = visibleWidth(prefix);
        const contentWidth = Math.max(1, width - prefixWidth);
        const renderedMarkdown = renderAgentMarkdown({
            text: entry.text,
            width: contentWidth,
            cwd: this.#cwd,
        });
        const indent = " ".repeat(prefixWidth);
        return renderedMarkdown.map((line, index) =>
            this.#fitLine(`${index === 0 ? prefix : indent}${line}`, width),
        );
    }

    #renderThinkingEntry(entry: AppTranscriptEntry, width: number): string[] {
        const prefix = `${DIM}•${RESET} `;
        const prefixWidth = visibleWidth(prefix);
        const contentWidth = Math.max(1, width - prefixWidth);
        const renderedMarkdown = renderAgentMarkdown({
            text: entry.text,
            width: contentWidth,
            cwd: this.#cwd,
        });
        const indent = " ".repeat(prefixWidth);
        return renderedMarkdown.map((line, index) =>
            this.#fitLine(`${index === 0 ? prefix : indent}${line}`, width),
        );
    }

    #renderToolEntry(entry: AppTranscriptEntry, width: number, isError: boolean): string[] {
        if (
            !isError &&
            entry.title === PENDING_TOOL_CALL_TITLE &&
            entry.text === PENDING_TOOL_CALL_TITLE
        ) {
            return [this.#fitLine(`${DIM}• ${PENDING_TOOL_CALL_TITLE}${RESET}`, width)];
        }

        const toolName = entry.title ?? "tool";
        const verb = isError ? "Failed" : this.#toolVerb(toolName);
        const dot = isError ? RED : GREEN;
        const callText = this.#singleLine(entry.text);
        const titleSuffix =
            callText.length > 0 && callText !== toolName
                ? ` ${CYAN}${callText}${RESET}`
                : ` ${CYAN}${toolName}${RESET}`;
        const title = `${dot}•${RESET} ${RIG_ORANGE}${BOLD}${verb}${NOT_BOLD_OR_DIM}${titleSuffix}`;
        const lines = [this.#fitLine(title, width)];
        if (entry.detail !== undefined) {
            const detailText = entry.detail.length > 0 ? entry.detail : "(empty result)";
            lines.push(this.#fitLine(`  ${DIM}└${RESET} ${DIM}${detailText}${RESET}`, width));
        }
        return lines;
    }

    #renderNoticeEntry(title: string, text: string, width: number, color: string): string[] {
        const prefix = `${color}•${RESET} ${BOLD}${title}${NOT_BOLD_OR_DIM} `;
        const prefixWidth = visibleWidth(prefix);
        const wrapped = wrapTextWithAnsi(
            text.length === 0 ? " " : text,
            Math.max(1, width - prefixWidth),
        );
        const indent = " ".repeat(prefixWidth);
        return wrapped.map((line, index) =>
            this.#fitLine(`${index === 0 ? prefix : indent}${line}`, width),
        );
    }

    #emptyInputLine(): string {
        const placeholder =
            this.#freeformUserInput === undefined ? INPUT_PLACEHOLDER : "Type another answer";
        const marker = this.#focused ? CURSOR_MARKER : "";
        if (!this.#focused || !this.#cursorVisible) {
            return `${this.#inputPrompt()}${marker}${SURFACE_MUTED_FG}${placeholder}${INPUT_FG}`;
        }

        const firstCharacter = placeholder[0] ?? " ";
        const rest = placeholder.slice(firstCharacter.length);
        return `${this.#inputPrompt()}${marker}${CURSOR_BG}${CURSOR_FG}${firstCharacter}${RESET}${SURFACE_MUTED_FG}${rest}${INPUT_FG}`;
    }

    #surfaceLine(line: string, width: number): string {
        return `${SURFACE_BG}${SURFACE_FG}${this.#fitAndPadLine(line, width)}${RESET}`;
    }

    #inputSurfaceLine(line: string, width: number): string {
        const softened = this.#softenFakeCursor(line);
        return `${SURFACE_BG}${INPUT_FG}${this.#fitAndPadLine(this.#restoreInputSurface(softened), width)}${RESET}`;
    }

    #restoreInputSurface(line: string): string {
        return line.replaceAll(RESET, `${RESET}${SURFACE_BG}${INPUT_FG}`);
    }

    #softenFakeCursor(line: string): string {
        return line.replace(
            /\x1b\[7m([\s\S]*?)\x1b\[(?:27|0)m/gu,
            `${CURSOR_BG}${CURSOR_FG}$1${SURFACE_BG}${INPUT_FG}`,
        );
    }

    #activityText(): string | undefined {
        const label = this.#activityLabel();
        if (label === undefined) {
            return undefined;
        }

        const elapsed = this.#activityElapsedText();
        if (elapsed === undefined) {
            return label;
        }

        return `${label} (${elapsed})`;
    }

    #activityElapsedText(): string | undefined {
        if (this.#activityStartedAtMs === undefined) {
            return undefined;
        }

        return formatActivityElapsedTime(this.#now() - this.#activityStartedAtMs);
    }

    #activityLabel(): string | undefined {
        if (this.#statusText === "Idle") {
            return undefined;
        }
        if (this.#statusText === "Running") {
            return "Working";
        }
        if (this.#statusText.startsWith("Stopped:")) {
            return undefined;
        }

        return this.#statusText;
    }

    #shouldRenderActivityAsLastMessage(): boolean {
        return this.#running || this.#compacting;
    }

    #renderActivityLine(label: string, width: number): string[] {
        const prefix = `${RIG_ORANGE}•${RESET} `;
        const frame = this.#activityAnimationFrame;
        const elapsed = this.#activityElapsedText();
        const elapsedText = elapsed ?? "0s";
        const elapsedSuffix = ` ${DIM}${SURFACE_MUTED_FG}(${elapsedText} • Esc to interrupt)${RESET}`;

        return [
            this.#fitLine(`${prefix}${renderActivityWave(label, frame)}${elapsedSuffix}`, width),
        ];
    }

    #hideCursor(line: string): string {
        return line.replace(/\x1b\[7m([\s\S]*?)\x1b\[(?:27|0)m/gu, "$1");
    }

    #fitAndPadLine(line: string, width: number): string {
        const fitted = truncateToWidth(line, width, "", false);
        const padding = " ".repeat(Math.max(0, width - visibleWidth(fitted)));
        return `${fitted}${padding}`;
    }

    #turnSeparator(width: number): string {
        return this.#fitLine(`${DIM}${"─".repeat(width)}${RESET}`, width);
    }

    #directoryName(): string {
        return basename(this.#cwd) || this.#cwd;
    }

    #inputPrompt(): string {
        return `${RIG_ORANGE}${BOLD}›${NOT_BOLD_OR_DIM}${INPUT_FG} `;
    }

    #handleReasoningShortcut(data: string): boolean {
        const direction = this.#reasoningShortcutDirection(data);
        if (direction === undefined) {
            return false;
        }

        const nextEffort = this.#nextReasoningEffort(direction);
        if (nextEffort !== undefined) {
            this.#agent.setEffort(nextEffort);
            if (!this.#modelLocked) {
                this.#persistDefaultModel(this.#agent.model.id, nextEffort);
            }
        }

        return true;
    }

    #persistDefaultModel(
        modelId: string,
        effort: string,
        providerId: string = this.#agent.provider.id,
    ): void {
        if (this.#onDefaultModelChange === undefined) {
            return;
        }

        void Promise.resolve(
            this.#onDefaultModelChange({
                modelId,
                providerId,
                effort,
            }),
        ).catch(() => {
            if (this.#stopped || this.#exiting) {
                return;
            }
            this.#appendEntry({
                role: "event",
                title: "config",
                text: "Could not update the config file.",
            });
            this.#requestRender();
        });
    }

    #persistSettings(): void {
        if (this.#onSettingsChange === undefined) {
            return;
        }

        void Promise.resolve(
            this.#onSettingsChange({
                showReasoning: this.#showReasoning,
                showUsage: this.#showUsage,
            }),
        ).catch(() => {
            if (this.#stopped || this.#exiting) {
                return;
            }
            this.#appendEntry({
                role: "event",
                title: "config",
                text: "Could not update the config file.",
            });
            this.#requestRender();
        });
    }

    #modelChoices(): readonly CodingAssistantModelChoice[] {
        return (
            this.#agent.modelChoices ??
            this.#agent.provider.models.map((model) => ({
                model,
                providerId: this.#agent.provider.id,
            }))
        );
    }

    #handleModelMenuShortcut(data: string): boolean {
        if (MODEL_MENU_RAW_KEYS.has(data) || matchesKey(data, "alt+m")) {
            this.#openModelMenu();
            return true;
        }

        return false;
    }

    #refreshSkillCommands(options: { force?: boolean } = {}): Promise<void> {
        if (
            options.force !== true &&
            (this.#skillCommandsLoaded || this.#skillCommandsRefresh !== undefined)
        ) {
            return this.#skillCommandsRefresh ?? Promise.resolve();
        }

        const refresh = loadSkills(this.#agent.context.fs)
            .then((skills) => {
                this.#skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
                this.#skillCommands = skills.map((skill) => ({
                    value: `skill:${skill.name}`,
                    label: `/skill:${skill.name}`,
                    description: skill.description,
                    aliases: [],
                }));
                this.#skillCommandsLoaded = true;
            })
            .catch(() => {
                this.#skillsByName = new Map();
                this.#skillCommands = [];
                this.#skillCommandsLoaded = true;
            });

        const trackedRefresh = refresh.finally(() => {
            if (this.#skillCommandsRefresh === trackedRefresh) {
                this.#skillCommandsRefresh = undefined;
            }
            this.#requestRender();
        });
        this.#skillCommandsRefresh = trackedRefresh;
        return trackedRefresh;
    }

    #handleSlashCommandAutocompleteInput(data: string): boolean {
        const suggestions = this.#slashCommandSuggestions();
        if (suggestions.length === 0) {
            return false;
        }

        if (matchesKey(data, "up")) {
            this.#slashCommandSelectionIndex =
                (this.#slashCommandSelectionIndex + suggestions.length - 1) % suggestions.length;
            return true;
        }

        if (matchesKey(data, "down")) {
            this.#slashCommandSelectionIndex =
                (this.#slashCommandSelectionIndex + 1) % suggestions.length;
            return true;
        }

        if (matchesKey(data, "escape")) {
            this.#dismissedSlashCommandText = this.#editor.getText();
            return true;
        }

        if (matchesKey(data, "enter") || matchesKey(data, "tab")) {
            const selected = suggestions[this.#slashCommandSelectionIndex] ?? suggestions[0];
            if (selected === undefined) {
                return true;
            }

            this.#dismissedSlashCommandText = undefined;
            this.#submit(`/${selected.value}`);
            return true;
        }

        return false;
    }

    #slashCommandSuggestions(): readonly AutocompleteItem[] {
        const text = this.#editor.getText();
        if (
            text.length === 0 ||
            text === this.#dismissedSlashCommandText ||
            text.includes("\n") ||
            !text.startsWith("/") ||
            /\s/u.test(text)
        ) {
            return [];
        }

        const query = text.slice(1).toLowerCase();
        if (!this.#skillCommandsLoaded && this.#skillCommandsRefresh === undefined) {
            void this.#refreshSkillCommands();
        }

        const suggestions = [...this.#slashCommands, ...this.#skillCommands].filter(
            (command) =>
                command.value.toLowerCase().startsWith(query) ||
                command.aliases.some((alias) => alias.toLowerCase().startsWith(query)),
        );
        if (this.#slashCommandSelectionIndex >= suggestions.length) {
            this.#slashCommandSelectionIndex = 0;
        }

        return suggestions;
    }

    #completeFileMention(path: string, context: FileMentionContext): void {
        for (const _segment of FILE_MENTION_SEGMENTER.segment(context.prefix)) {
            this.#editor.handleInput("\x7f");
        }

        const suffix =
            context.afterCursor.length === 0 || !/^\s/u.test(context.afterCursor) ? " " : "";
        this.#editor.insertTextAtCursor(`${formatFileMention(path)}${suffix}`);
        this.#fileMentionAutocomplete?.clear();
        this.#syncAutocompleteState();
    }

    #fileMentionSnapshot() {
        return this.#fileMentionAutocomplete?.snapshot(
            this.#editor.getLines(),
            this.#editor.getCursor(),
        );
    }

    #syncAutocompleteState(): void {
        const text = this.#editor.getText();
        if (
            this.#dismissedSlashCommandText !== undefined &&
            text !== this.#dismissedSlashCommandText
        ) {
            this.#dismissedSlashCommandText = undefined;
        }
        this.#slashCommandSuggestions();
        this.#fileMentionAutocomplete?.sync(this.#editor.getLines(), this.#editor.getCursor());
    }

    #reasoningShortcutDirection(data: string): "down" | "up" | undefined {
        if (
            REASONING_DOWN_RAW_KEYS.has(data) ||
            matchesKey(data, "alt+,") ||
            matchesKey(data, "shift+down")
        ) {
            return "down";
        }
        if (
            REASONING_UP_RAW_KEYS.has(data) ||
            matchesKey(data, "alt+.") ||
            matchesKey(data, "shift+up")
        ) {
            return "up";
        }

        return undefined;
    }

    #nextReasoningEffort(direction: "down" | "up"): string | undefined {
        const choices = [...this.#agent.model.thinkingLevels];
        if (choices.length === 0) {
            return undefined;
        }

        const firstChoice = choices[0];
        if (firstChoice === undefined) {
            return undefined;
        }

        const snapshotEffort = this.#agent.snapshot().effort;
        const fallbackEffort = this.#agent.model.defaultThinkingLevel;
        const currentEffort =
            snapshotEffort !== undefined && choices.includes(snapshotEffort)
                ? snapshotEffort
                : choices.includes(fallbackEffort)
                  ? fallbackEffort
                  : firstChoice;
        const currentIndex = choices.indexOf(currentEffort);
        const nextIndex = direction === "up" ? currentIndex + 1 : currentIndex - 1;

        return choices[nextIndex];
    }

    #modelDisplayName(): string {
        return this.#agent.model.name;
    }

    #modelWithReasoningDisplayName(): string {
        const effort = this.#agent.snapshot().effort ?? this.#agent.model.defaultThinkingLevel;
        return effort === undefined
            ? this.#modelDisplayName()
            : `${this.#modelDisplayName()} ${humanizeReasoningLevel(effort)}`;
    }

    #cwdDisplayName(): string {
        const home = homedir();
        if (this.#cwd === home) {
            return "~";
        }
        if (this.#cwd.startsWith(`${home}/`)) {
            return `~/${this.#cwd.slice(home.length + 1)}`;
        }

        return this.#cwd;
    }

    #toolVerb(toolName: string): string {
        const normalized = toolName.toLowerCase();
        if (normalized.includes("bash") || normalized.includes("exec")) {
            return "Ran";
        }
        if (
            normalized.includes("grep") ||
            normalized.includes("find") ||
            normalized.includes("glob") ||
            normalized === "ls"
        ) {
            return "Explored";
        }
        if (normalized.includes("read") || normalized.includes("view")) {
            return "Read";
        }
        if (
            normalized.includes("write") ||
            normalized.includes("edit") ||
            normalized.includes("patch")
        ) {
            return "Edited";
        }

        return "Used";
    }

    #isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    #singleLine(text: string): string {
        return sanitizeTerminalText(text).replace(/\s+/gu, " ").trim();
    }

    #markTypingActivity(): void {
        this.#cursorTyping = true;
        this.#cursorVisible = true;

        if (this.#cursorTypingDebounceTimer !== undefined) {
            clearTimeout(this.#cursorTypingDebounceTimer);
        }

        this.#cursorTypingDebounceTimer = setTimeout(() => {
            this.#cursorTypingDebounceTimer = undefined;
            this.#cursorTyping = false;
        }, CURSOR_TYPING_DEBOUNCE_MS);
        this.#cursorTypingDebounceTimer.unref?.();
    }

    #stripEditorChrome(lines: string[]): string[] {
        let content = [...lines];

        while (content.length > 0 && this.#isEditorBorderLine(content[0] ?? "")) {
            content = content.slice(1);
        }
        while (content.length > 0 && this.#isEditorBorderLine(content[content.length - 1] ?? "")) {
            content = content.slice(0, -1);
        }

        return content.filter((line) => !this.#isEditorBorderLine(line));
    }

    #isEditorScrollIndicator(line: string): boolean {
        const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
        return stripped.includes(" more ") && (stripped.includes("↑") || stripped.includes("↓"));
    }

    #isEditorBorderLine(line: string): boolean {
        const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
        return stripped.length > 0 && [...stripped].every((character) => character === "─");
    }

    #stripSpuriousLeadingEmptyLine(lines: string[]): string[] {
        if (lines.length <= 1) {
            return lines;
        }

        const first = lines[0] ?? "";
        if (this.#isVisibleEditorLine(first)) {
            return lines;
        }

        return lines.slice(1);
    }

    #isVisibleEditorLine(line: string): boolean {
        const stripped = line
            .replace(/\x1b\[[0-9;]*m/g, "")
            .replaceAll(CURSOR_MARKER, "")
            .trim();
        return stripped.length > 0 || line.includes("\x1b[7m") || line.includes(CURSOR_MARKER);
    }

    #startCursorBlink(): void {
        if (this.#cursorBlinkTimer !== undefined || this.#stopped) {
            return;
        }

        this.#cursorBlinkTimer = setInterval(() => {
            if (!this.#focused || this.#stopped || this.#cursorTyping) {
                return;
            }

            this.#cursorVisible = !this.#cursorVisible;
            this.#requestRender();
        }, CURSOR_BLINK_MS);
        this.#cursorBlinkTimer.unref?.();
    }

    #stopCursorBlink(): void {
        if (this.#cursorTypingDebounceTimer !== undefined) {
            clearTimeout(this.#cursorTypingDebounceTimer);
            this.#cursorTypingDebounceTimer = undefined;
        }

        this.#cursorTyping = false;

        if (this.#cursorBlinkTimer === undefined) {
            return;
        }

        clearInterval(this.#cursorBlinkTimer);
        this.#cursorBlinkTimer = undefined;
        this.#cursorVisible = true;
    }

    #startActivityAnimation(): void {
        if (this.#activityAnimationTimer !== undefined || this.#stopped) {
            return;
        }

        this.#activityAnimationFrame = 0;
        this.#activityAnimationTimer = setInterval(() => {
            if (this.#stopped || this.#exiting) {
                return;
            }

            this.#activityAnimationFrame =
                (this.#activityAnimationFrame + 1) % ACTIVITY_WAVE_FRAME_COUNT;
            if (this.#activityText() !== undefined) {
                this.#requestRender();
            }
        }, ACTIVITY_ANIMATION_MS);
        this.#activityAnimationTimer.unref?.();
    }

    #stopActivityAnimation(): void {
        if (this.#activityAnimationTimer === undefined) {
            this.#activityAnimationFrame = 0;
            this.#activityStartedAtMs = undefined;
            return;
        }

        clearInterval(this.#activityAnimationTimer);
        this.#activityAnimationTimer = undefined;
        this.#activityAnimationFrame = 0;
        this.#activityStartedAtMs = undefined;
    }

    #requestRender(force = false): void {
        if (!this.#stopped) {
            this.#tui.requestRender(force);
        }
    }

    #waitForShutdownRender(): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, 25);
        });
    }

    #handleCtrlC(): void {
        if (this.#editor.getText().length > 0) {
            this.#editor.setText("");
            this.#fileMentionAutocomplete?.clear();
            this.#dismissedSlashCommandText = undefined;
            this.#pastedImagesById.clear();
            this.#requestRender();
            return;
        }
        if (this.#abortActiveRun()) return;
        void this.stop();
    }

    #queueCurrentInput(): boolean {
        const submission = this.#createPromptSubmission(this.#editor.getText());
        if (submission === undefined) return false;
        this.#editor.setText("");
        this.#fileMentionAutocomplete?.clear();
        this.#modelLocked = true;
        this.#pendingPrompts.push(submission);
        this.#requestRender();
        return true;
    }

    #setTerminalFocused(focused: boolean): void {
        if (this.#terminalFocused === focused) return;
        this.#terminalFocused = focused;
        this.#editor.focused = this.#focused && focused;
        if (focused && this.#focused) {
            this.#cursorVisible = true;
            this.#startCursorBlink();
        } else {
            this.#stopCursorBlink();
            this.#cursorVisible = false;
        }
        this.#requestRender();
    }
}
