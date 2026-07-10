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
import type { SessionEvent } from "../protocol/index.js";
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
import { humanizeReasoningLevel } from "./humanizeReasoningLevel.js";
import {
    readClipboardImage,
    type ClipboardImage,
    type ReadClipboardImageOptions,
} from "./readClipboardImage.js";
import { ACTIVITY_WAVE_FRAME_COUNT, renderActivityWave } from "./renderActivityWave.js";
import { renderAgentMarkdown } from "./renderAgentMarkdown.js";

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
const SLASH_COMMAND_MAX_VISIBLE = 6;
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const IMAGE_PLACEHOLDER_REGEX = /\[Image #(\d+) [A-Z0-9]+\]/gu;
const IMAGE_CHIP_BG = "\x1b[48;5;240m";
const IMAGE_CHIP_FG = "\x1b[38;5;255m";

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
    initialSessionEvents?: readonly SessionEvent[];
    modelLocked?: boolean;
    processManager: NativeProxessManager;
    sessionBacked?: boolean;
    tui: TUI;
    idFactory?: () => string;
    onDefaultModelChange?: (preference: DefaultModelPreference) => void | Promise<void>;
    onSettingsChange?: (settings: AppSettings) => void | Promise<void>;
    onExit?: () => void | Promise<void>;
    now?: () => number;
    readClipboardImage?: (
        options?: ReadClipboardImageOptions,
    ) => Promise<ClipboardImage | undefined>;
    showReasoning?: boolean;
    version?: string;
}

export interface DefaultModelPreference {
    effort: string;
    modelId: string;
    providerId: string;
}

export interface AppSettings {
    showReasoning: boolean;
}

interface PendingPrompt {
    content: string | readonly ContentBlock[];
    displayText: string;
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
}

export class CodingAssistantApp implements Component, Focusable {
    readonly #agent: CodingAssistantAgentBackend;
    readonly #cwd: string;
    readonly #idFactory: () => string;
    readonly #now: () => number;
    readonly #editor: Editor;
    readonly #onDefaultModelChange:
        | ((preference: DefaultModelPreference) => void | Promise<void>)
        | undefined;
    readonly #onSettingsChange: ((settings: AppSettings) => void | Promise<void>) | undefined;
    readonly #onExit: (() => void | Promise<void>) | undefined;
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
    #activityAnimationFrame = 0;
    #activityStartedAtMs: number | undefined;
    #activityAnimationTimer: ReturnType<typeof setInterval> | undefined;
    #cursorBlinkTimer: ReturnType<typeof setInterval> | undefined;
    #cursorTyping = false;
    #cursorTypingDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    #cursorVisible = true;
    #entries: AppTranscriptEntry[] = [];
    #exiting = false;
    #exitResolve: (() => void) | undefined;
    #focused = false;
    #pendingPrompts: PendingPrompt[] = [];
    #pastedImagesById = new Map<number, PastedImage>();
    #selectionPanel: Component | undefined;
    #dismissedSlashCommandText: string | undefined;
    #activeSubmission: Promise<void> | undefined;
    #bracketedPasteBuffer: string | undefined;
    #showReasoning: boolean;
    #sessionBacked: boolean;
    #modelLocked: boolean;
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
    #thinkingEntryIdsByContentIndex = new Map<number, string>();
    #toolCallEntryIdsByContentIndex = new Map<number, string>();

    constructor(options: CodingAssistantAppOptions) {
        this.#agent = options.agent;
        this.#cwd = options.cwd;
        this.#idFactory = options.idFactory ?? createId;
        this.#now = options.now ?? Date.now;
        this.#onDefaultModelChange = options.onDefaultModelChange;
        this.#onSettingsChange = options.onSettingsChange;
        this.#onExit = options.onExit;
        this.#processManager = options.processManager;
        this.#readClipboardImage = options.readClipboardImage ?? readClipboardImage;
        this.#sessionBacked = options.sessionBacked ?? false;
        this.#showReasoning = options.showReasoning ?? false;
        this.#modelLocked = options.modelLocked ?? !options.agent.canChangeModel;
        this.#tui = options.tui;
        this.#version = options.version ?? "0.0.0";
        this.#editor = new Editor(this.#tui, EDITOR_THEME, { paddingX: 0 });
        this.#exitPromise = new Promise((resolve) => {
            this.#exitResolve = resolve;
        });

        this.#editor.onSubmit = (value) => {
            this.#submit(value);
        };

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
        this.#editor.focused = value;
        this.#cursorVisible = true;
        if (value) {
            this.#cursorTyping = false;
            this.#startCursorBlink();
        } else {
            this.#stopCursorBlink();
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

        if (event.type === "run_finished") {
            this.#running = false;
            this.#statusText =
                event.data.stopReason === "stop" ? "Idle" : `Stopped: ${event.data.stopReason}`;
            this.#stopActivityAnimation();
            this.#streamEntryId = undefined;
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
            this.#requestRender();
            return;
        }

        if (event.type === "run_error") {
            this.#running = false;
            this.#statusText = "Error";
            this.#stopActivityAnimation();
            this.#appendEntry({ role: "error", text: event.data.errorMessage });
            return;
        }

        if (event.type === "session_reset") {
            this.#entries = [];
            this.#modelLocked = false;
            this.#seenToolCallIds.clear();
            this.#streamEntryId = undefined;
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
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

        if (this.#selectionPanel !== undefined) {
            if (matchesKey(data, "ctrl+c") || data === "\x03") {
                void this.stop();
                return;
            }
            this.#selectionPanel.handleInput?.(data);
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
            void this.stop();
            return;
        }

        if (matchesKey(data, "ctrl+d") && this.#editor.getText().length === 0) {
            void this.stop();
            return;
        }

        const previousSlashCommandSuggestionCount = this.#slashCommandSuggestions().length;
        if (this.#handleSlashCommandAutocompleteInput(data)) {
            const nextSlashCommandSuggestionCount = this.#slashCommandSuggestions().length;
            this.#requestRender(
                nextSlashCommandSuggestionCount < previousSlashCommandSuggestionCount,
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
        this.#syncSlashCommandAutocompleteState();
        const nextSlashCommandSuggestionCount = this.#slashCommandSuggestions().length;
        this.#requestRender(nextSlashCommandSuggestionCount < previousSlashCommandSuggestionCount);
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
        this.#syncSlashCommandAutocompleteState();
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
            this.#syncSlashCommandAutocompleteState();
            this.#requestRender();
            return;
        }

        this.#markTypingActivity();
        this.#editor.handleInput(`${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`);
        this.#syncSlashCommandAutocompleteState();
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
        const header = this.#renderHeader(safeWidth);
        const slashCommandSuggestions = this.#slashCommandSuggestions();
        const footer = this.#renderFooter(safeWidth, slashCommandSuggestions);
        const input = this.#renderInput(safeWidth);

        if (this.#exiting) {
            return [...header, ...this.#renderTranscript(safeWidth)];
        }

        return [
            ...header,
            ...this.#renderTranscript(safeWidth),
            "",
            ...(this.#selectionPanel === undefined
                ? input
                : this.#selectionPanel.render(safeWidth)),
            "",
            ...footer,
            "",
            "",
        ];
    }

    #submit(value: string): void {
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
        const submission = this.#createPromptSubmission(value);
        if (submission === undefined) {
            return;
        }
        const prompt = submission.displayText;

        this.#editor.setText("");

        if (prompt.startsWith("/skill:")) {
            await this.#submitSkillCommand(prompt);
            this.#requestRender();
            return;
        }

        if (this.#handleCommand(prompt)) {
            this.#requestRender();
            return;
        }

        this.#modelLocked = true;
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

        this.#pendingPrompts.push(submission);
        this.#startDrainQueue();
        this.#requestRender();
    }

    #createPromptSubmission(value: string): PromptSubmission | undefined {
        const prompt = value.trim();
        if (prompt.length === 0) {
            return undefined;
        }

        const content = this.#contentFromPrompt(prompt);
        this.#clearSubmittedImages(prompt);
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

        if (prompt === "/new") {
            this.#resetSession();
            return true;
        }

        if (prompt === "/exit") {
            void this.stop();
            return true;
        }

        if (prompt === "/clear") {
            this.#entries = [];
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

    #resetSession(): void {
        this.#abortActiveRun({ silent: true });
        this.#runToken += 1;
        this.#pendingPrompts = [];
        this.#pastedImagesById.clear();
        this.#entries = [];
        this.#modelLocked = false;
        this.#seenToolCallIds.clear();
        this.#streamEntryId = undefined;
        this.#thinkingEntryIdsByContentIndex.clear();
        this.#toolCallEntryIdsByContentIndex.clear();
        this.#abortNotified = false;
        this.#statusText = "Idle";
        this.#agent.reset();
        this.#appendEntry({
            role: "system",
            text: "Session reset. Started a new session.",
        });
    }

    #startDrainQueue(): void {
        if (this.#activeRun !== undefined) {
            return;
        }

        this.#activeRun = this.#drainQueue().finally(() => {
            this.#activeRun = undefined;
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
            if (!this.#isCurrentRun(runToken)) {
                return;
            }
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

    #handleEscape(): void {
        if (this.#abortActiveRun()) {
            return;
        }

        void this.stop();
    }

    #abortActiveRun(options: { silent?: boolean } = {}): boolean {
        if (!this.#running || this.#abortController === undefined) {
            return false;
        }

        const controller = this.#abortController;
        this.#runToken += 1;
        controller.abort();
        this.#abortController = undefined;
        this.#pendingPrompts = [];
        this.#running = false;
        this.#statusText = "Idle";
        this.#streamEntryId = undefined;
        this.#thinkingEntryIdsByContentIndex.clear();
        this.#toolCallEntryIdsByContentIndex.clear();
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
                    title: block.name,
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
        this.#statusText = `Calling ${toolCall.name}`;

        const existingId = this.#toolCallEntryIdsByContentIndex.get(contentIndex);
        const existing =
            existingId === undefined
                ? undefined
                : this.#entries.find((entry) => entry.id === existingId);

        if (existing !== undefined) {
            existing.id = toolCall.id;
            existing.title = toolCall.name;
            existing.text = this.#formatToolCall(toolCall.name, toolCall.arguments);
            this.#toolCallEntryIdsByContentIndex.delete(contentIndex);
            return;
        }

        this.#toolCallEntryIdsByContentIndex.delete(contentIndex);
        this.#appendEntry({
            id: toolCall.id,
            role: "tool",
            title: toolCall.name,
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
            this.#entries = this.#entries.slice(-MAX_TRANSCRIPT_ENTRIES);
        }
        this.#requestRender();
        return completeEntry;
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
            this.#entries.length === 0
                ? [{ id: "ready", role: "system" as const, text: "Ready." }]
                : this.#entries;
        const entries = this.#showReasoning
            ? sourceEntries
            : sourceEntries.filter((entry) => entry.role !== "thinking");
        const lines: string[] = [];

        for (const entry of entries) {
            if (lines.length > 0) {
                lines.push("");
            }
            lines.push(...this.#renderEntry(entry, width));
        }

        const activityLabel = this.#activityLabel();
        if (activityLabel !== undefined && this.#shouldRenderActivityAsLastMessage()) {
            if (lines.length > 0) {
                lines.push("");
            }
            lines.push(...this.#renderActivityLine(activityLabel, width));
        }

        return lines;
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
        slashCommandSuggestions: readonly AutocompleteItem[] = this.#slashCommandSuggestions(),
    ): string[] {
        if (slashCommandSuggestions.length > 0) {
            return this.#renderSlashCommandAutocomplete(width, slashCommandSuggestions);
        }

        const parts = [`${FOOTER_MODEL_FG}${this.#modelWithReasoningDisplayName()}${RESET}`];
        parts.push(`${FOOTER_CWD_FG}${this.#cwdDisplayName()}${RESET}`);
        if (this.#pendingPrompts.length > 0) {
            parts.push(`${FOOTER_QUEUED_FG}queued ${this.#pendingPrompts.length}${RESET}`);
        }

        const line = `${" ".repeat(visibleWidth(INPUT_PROMPT))}${parts.join(`${DIM} • ${RESET}`)}`;
        return [this.#fitLine(line, width)];
    }

    #renderSlashCommandAutocomplete(
        width: number,
        suggestions: readonly AutocompleteItem[],
        maxVisible = SLASH_COMMAND_MAX_VISIBLE,
    ): string[] {
        const rowWidth = Math.max(1, width - 1);
        const visibleCount = Math.max(1, Math.min(maxVisible, SLASH_COMMAND_MAX_VISIBLE));
        const selectedIndex = Math.min(this.#slashCommandSelectionIndex, suggestions.length - 1);
        const startIndex = Math.max(
            0,
            Math.min(
                selectedIndex - Math.floor(visibleCount / 2),
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
            const isSelected = absoluteIndex === selectedIndex;
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
                ? "Model is locked for this session"
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
                        text: "Model cannot be changed after the first message. Use /effort to change reasoning.",
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

        const selectedValue = this.#showReasoning ? "show" : "hide";
        const panel = createSelectionPanel({
            title: "Configure",
            subtitle: "App settings",
            selectedValue,
            items: [
                {
                    value: "show",
                    label: "Show reasoning",
                    description: this.#showReasoning
                        ? "Current setting"
                        : "Display reasoning blocks in the transcript.",
                },
                {
                    value: "hide",
                    label: "Hide reasoning",
                    description: this.#showReasoning
                        ? "Hide reasoning blocks from the transcript."
                        : "Current setting",
                },
            ],
            onSelect: (item) => {
                const showReasoning = item.value === "show";
                this.#setShowReasoning(showReasoning);
                this.#closeSelectionPanel();
                this.#appendEntry({
                    role: "event",
                    title: "settings",
                    text: showReasoning
                        ? "Reasoning display enabled."
                        : "Reasoning display disabled.",
                });
                this.#requestRender();
            },
            onCancel: () => {
                this.#closeSelectionPanel();
            },
        });
        this.#showSelectionPanel(panel);
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
            const prefix = index === 0 ? this.#inputPrompt() : INPUT_LINE_INDENT;
            const rendered = `${prefix}${this.#styleImagePlaceholders(line)}`;
            return this.#inputSurfaceLine(
                this.#cursorVisible ? rendered : this.#hideCursor(rendered),
                width,
            );
        });
    }

    #finishToolResult(block: ToolResultBlock): void {
        const existing = this.#entries.find((entry) => entry.id === block.toolCallId);
        const detail = this.#formatToolResult(block);
        if (existing !== undefined) {
            existing.role = block.isError ? "error" : "tool";
            existing.title = block.toolName;
            existing.detail = detail;
            return;
        }

        this.#appendEntry({
            id: block.toolCallId,
            role: block.isError ? "error" : "tool",
            title: block.toolName,
            text: block.toolName,
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

        return toolName;
    }

    #formatToolResult(block: ToolResultBlock): string {
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
            return [
                this.#fitLine(
                    `${DIM}•${RESET} ${renderActivityWave(PENDING_TOOL_CALL_TITLE, this.#activityAnimationFrame)}`,
                    width,
                ),
            ];
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
        const marker = this.#focused ? CURSOR_MARKER : "";
        if (!this.#focused || !this.#cursorVisible) {
            return `${this.#inputPrompt()}${marker}${SURFACE_MUTED_FG}${INPUT_PLACEHOLDER}${INPUT_FG}`;
        }

        const firstCharacter = INPUT_PLACEHOLDER[0] ?? " ";
        const rest = INPUT_PLACEHOLDER.slice(firstCharacter.length);
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
        if (this.#streamEntryId !== undefined) {
            return false;
        }

        const lastEntry = this.#entries.at(-1);
        return (
            lastEntry === undefined ||
            lastEntry.role === "separator" ||
            lastEntry.role === "user" ||
            lastEntry.role === "system" ||
            (lastEntry.role === "thinking" && !this.#showReasoning)
        );
    }

    #renderActivityLine(label: string, width: number): string[] {
        const prefix = `${RIG_ORANGE}•${RESET} `;
        const frame = this.#activityAnimationFrame;
        const elapsed = this.#activityElapsedText();
        const elapsedSuffix =
            elapsed === undefined ? "" : ` ${DIM}${SURFACE_MUTED_FG}(${elapsed})${RESET}`;

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

    #setShowReasoning(showReasoning: boolean): void {
        if (this.#showReasoning === showReasoning) {
            return;
        }

        this.#showReasoning = showReasoning;
        this.#persistSettings();
    }

    #persistSettings(): void {
        if (this.#onSettingsChange === undefined) {
            return;
        }

        void Promise.resolve(
            this.#onSettingsChange({
                showReasoning: this.#showReasoning,
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

    #syncSlashCommandAutocompleteState(): void {
        const text = this.#editor.getText();
        if (
            this.#dismissedSlashCommandText !== undefined &&
            text !== this.#dismissedSlashCommandText
        ) {
            this.#dismissedSlashCommandText = undefined;
        }
        this.#slashCommandSuggestions();
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
        return text.replace(/\s+/gu, " ").trim();
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

        return content.filter(
            (line) => !line.includes(" more ") && !this.#isEditorBorderLine(line),
        );
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
            if (this.#activityText() !== undefined && this.#shouldRenderActivityAsLastMessage()) {
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
}
