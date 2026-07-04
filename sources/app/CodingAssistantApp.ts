import { createId } from "@paralleldrive/cuid2";
import {
  Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";

import {
  contentBlockToText,
  type Agent,
  type Message,
  type ToolResultBlock,
} from "../agent/index.js";
import type { NativeProxessManager } from "../processes/index.js";
import type { AssistantMessageEvent } from "../providers/types.js";
import type { AppTranscriptEntry, AppTranscriptRole } from "./AppTranscriptEntry.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

const MAX_TRANSCRIPT_ENTRIES = 500;

export interface CodingAssistantAppOptions {
  agent: Agent;
  cwd: string;
  processManager: NativeProxessManager;
  tui: TUI;
  idFactory?: () => string;
  onExit?: () => void | Promise<void>;
}

export class CodingAssistantApp implements Component, Focusable {
  readonly #agent: Agent;
  readonly #cwd: string;
  readonly #idFactory: () => string;
  readonly #input = new Input();
  readonly #onExit: (() => void | Promise<void>) | undefined;
  readonly #processManager: NativeProxessManager;
  readonly #tui: TUI;
  readonly #exitPromise: Promise<void>;

  #abortController: AbortController | undefined;
  #abortNotified = false;
  #activeRun: Promise<void> | undefined;
  #entries: AppTranscriptEntry[] = [];
  #exitResolve: (() => void) | undefined;
  #focused = false;
  #pendingPrompts: string[] = [];
  #running = false;
  #seenToolCallIds = new Set<string>();
  #statusText = "Idle";
  #stopped = false;
  #streamEntryId: string | undefined;

  constructor(options: CodingAssistantAppOptions) {
    this.#agent = options.agent;
    this.#cwd = options.cwd;
    this.#idFactory = options.idFactory ?? createId;
    this.#onExit = options.onExit;
    this.#processManager = options.processManager;
    this.#tui = options.tui;
    this.#exitPromise = new Promise((resolve) => {
      this.#exitResolve = resolve;
    });

    this.#input.onSubmit = (value) => {
      this.#submit(value);
    };
    this.#input.onEscape = () => {
      this.#handleEscape();
    };
  }

  get focused(): boolean {
    return this.#focused;
  }

  set focused(value: boolean) {
    this.#focused = value;
    this.#input.focused = value;
  }

  start(): void {
    this.#tui.addChild(this);
    this.#tui.setFocus(this);
    this.#tui.start();
    this.#requestRender();
  }

  async stop(): Promise<void> {
    if (this.#stopped) {
      return;
    }

    this.#stopped = true;
    this.#statusText = "Stopped";
    this.#abortController?.abort();

    try {
      await this.#processManager.killAll({ forceAfterMs: 500 });
      this.#tui.stop();
      await this.#onExit?.();
    } finally {
      this.#exitResolve?.();
      this.#requestRender();
    }
  }

  waitForExit(): Promise<void> {
    return this.#exitPromise;
  }

  async waitForIdle(): Promise<void> {
    for (;;) {
      const activeRun = this.#activeRun;
      if (activeRun === undefined) {
        return;
      }

      await activeRun;
    }
  }

  handleInput(data: string): void {
    if (this.#stopped) {
      return;
    }

    if (matchesKey(data, "ctrl+d") && this.#input.getValue().length === 0) {
      void this.stop();
      return;
    }

    this.#input.handleInput(data);
    this.#requestRender();
  }

  invalidate(): void {
    this.#input.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const rows = Math.max(10, this.#tui.terminal.rows);
    const header = this.#renderHeader(safeWidth);
    const footer = this.#renderFooter(safeWidth);
    const input = this.#renderInput(safeWidth);
    const transcriptHeight = Math.max(
      1,
      rows - header.length - footer.length - input.length,
    );

    return [
      ...header,
      ...this.#renderTranscript(safeWidth, transcriptHeight),
      ...footer,
      ...input,
    ];
  }

  #submit(value: string): void {
    const prompt = value.trim();
    if (prompt.length === 0) {
      return;
    }

    this.#input.setValue("");
    if (this.#handleCommand(prompt)) {
      this.#requestRender();
      return;
    }

    this.#appendEntry({ role: "user", text: prompt });
    if (this.#running) {
      this.#appendEntry({
        role: "event",
        title: "queue",
        text: `Queued behind the active run.`,
      });
    }

    this.#pendingPrompts.push(prompt);
    this.#startDrainQueue();
    this.#requestRender();
  }

  #handleCommand(prompt: string): boolean {
    if (prompt === "/exit" || prompt === "/quit") {
      void this.stop();
      return true;
    }

    if (prompt === "/clear") {
      this.#entries = [];
      this.#streamEntryId = undefined;
      this.#appendEntry({ role: "system", text: "Transcript cleared." });
      return true;
    }

    if (prompt === "/abort") {
      if (this.#running && this.#abortController !== undefined) {
        this.#abortController.abort();
        this.#statusText = "Aborting";
        this.#appendAbortNotice();
      } else {
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

  async #runPrompt(prompt: string): Promise<void> {
    const controller = new AbortController();
    this.#abortController = controller;
    this.#abortNotified = false;
    this.#running = true;
    this.#statusText = "Running";
    this.#streamEntryId = undefined;
    this.#requestRender();

    try {
      const result = await this.#agent.send(prompt, {
        signal: controller.signal,
        onEvent: (event) => this.#handleAgentEvent(event),
        onMessage: (message) => this.#handleAgentMessage(message),
      });

      this.#statusText =
        result.stopReason === "stop" ? "Idle" : `Stopped: ${result.stopReason}`;
      if (result.stopReason === "aborted") {
        this.#appendAbortNotice();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        this.#statusText = "Idle";
        this.#appendAbortNotice();
      } else {
        this.#statusText = "Error";
        this.#appendEntry({ role: "error", text: this.#formatError(error) });
      }
    } finally {
      if (this.#abortController === controller) {
        this.#abortController = undefined;
      }
      this.#running = false;
      this.#streamEntryId = undefined;
      this.#requestRender();
    }
  }

  #handleEscape(): void {
    if (this.#running && this.#abortController !== undefined) {
      this.#statusText = "Aborting";
      this.#abortController.abort();
      this.#appendAbortNotice();
      return;
    }

    void this.stop();
  }

  #handleAgentEvent(event: AssistantMessageEvent): void {
    if (this.#stopped) {
      return;
    }

    if (event.type === "text_start") {
      this.#ensureStreamEntry();
    } else if (event.type === "text_delta") {
      this.#appendStreamText(event.delta);
    } else if (event.type === "text_end") {
      this.#finishStreamText(event.content);
    } else if (event.type === "thinking_start") {
      this.#statusText = "Thinking";
    } else if (event.type === "toolcall_end") {
      this.#seenToolCallIds.add(event.toolCall.id);
      this.#statusText = `Calling ${event.toolCall.name}`;
      this.#appendEntry({
        role: "tool",
        title: event.toolCall.name,
        text: this.#formatToolCall(event.toolCall.arguments),
      });
    } else if (event.type === "done") {
      this.#statusText = event.reason === "toolUse" ? "Running tools" : "Idle";
    } else if (event.type === "error") {
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
    this.#appendEntry({ role: "event", title: "abort", text: "Run aborted." });
  }

  #handleAgentMessage(message: Message): void {
    if (message.role !== "agent") {
      return;
    }

    const text = message.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text.length > 0) {
      this.#finishAssistantMessage(message.id, text);
    }

    for (const block of message.blocks) {
      if (block.type === "tool_call" && !this.#seenToolCallIds.has(block.id)) {
        this.#seenToolCallIds.add(block.id);
        this.#appendEntry({
          role: "tool",
          title: block.name,
          text: this.#formatToolCall(block.arguments),
        });
      } else if (block.type === "tool_result") {
        this.#appendEntry({
          role: block.isError ? "error" : "tool",
          title: block.toolName,
          text: this.#formatToolResult(block),
        });
      }
    }

    this.#requestRender();
  }

  #ensureStreamEntry(): AppTranscriptEntry {
    const existing = this.#streamEntryId === undefined
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

  #appendEntry(
    entry: Omit<AppTranscriptEntry, "id"> & { id?: string },
  ): AppTranscriptEntry {
    const completeEntry: AppTranscriptEntry = {
      id: entry.id ?? this.#idFactory(),
      role: entry.role,
      text: entry.text,
    };
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
    const model = `${this.#agent.provider.id}:${this.#agent.model.id}`;
    return [
      this.#fitLine(`${BOLD}ohmypi${RESET} ${DIM}${model}${RESET}`, width),
      this.#fitLine(`${DIM}${this.#cwd}${RESET}`, width),
      this.#fitLine(`${DIM}${"-".repeat(width)}${RESET}`, width),
    ];
  }

  #renderTranscript(width: number, maxLines: number): string[] {
    const sourceEntries = this.#entries.length === 0
      ? [{ id: "ready", role: "system" as const, text: "Ready." }]
      : this.#entries;
    const lines: string[] = [];

    for (const entry of sourceEntries) {
      lines.push(...this.#renderEntry(entry, width));
    }

    const tail = lines.slice(-maxLines);
    const padding = Array.from({ length: Math.max(0, maxLines - tail.length) }, () => "");
    return [...padding, ...tail];
  }

  #renderEntry(entry: AppTranscriptEntry, width: number): string[] {
    const label = this.#entryLabel(entry.role, entry.title);
    const prefix = `${label} `;
    const prefixWidth = visibleWidth(prefix);
    const contentWidth = Math.max(1, width - prefixWidth);
    const wrapped = wrapTextWithAnsi(entry.text.length === 0 ? " " : entry.text, contentWidth);
    const indent = " ".repeat(prefixWidth);
    return wrapped.map((line, index) =>
      this.#fitLine(`${index === 0 ? prefix : indent}${line}`, width),
    );
  }

  #renderFooter(width: number): string[] {
    const activeProcesses = this.#processManager.activeCount();
    const queue = this.#pendingPrompts.length > 0
      ? ` | queued ${this.#pendingPrompts.length}`
      : "";
    const processes = activeProcesses > 0 ? ` | processes ${activeProcesses}` : "";
    return [
      this.#fitLine(`${DIM}${"-".repeat(width)}${RESET}`, width),
      this.#fitLine(`${DIM}${this.#statusText}${queue}${processes} | /clear /abort /quit${RESET}`, width),
    ];
  }

  #renderInput(width: number): string[] {
    return [
      this.#fitLine(`${GREEN}${BOLD}You:${RESET}`, width),
      ...this.#input.render(width).map((line) => this.#fitLine(line, width)),
    ];
  }

  #entryLabel(role: AppTranscriptRole, title: string | undefined): string {
    if (role === "user") {
      return `${GREEN}${BOLD}You:${RESET}`;
    }
    if (role === "assistant") {
      return `${BLUE}${BOLD}Agent:${RESET}`;
    }
    if (role === "tool") {
      return `${MAGENTA}[${title ?? "tool"}]${RESET}`;
    }
    if (role === "event") {
      return `${YELLOW}[${title ?? "event"}]${RESET}`;
    }
    if (role === "error") {
      return `${RED}[${title ?? "error"}]${RESET}`;
    }
    return `${DIM}[system]${RESET}`;
  }

  #formatToolCall(args: unknown): string {
    try {
      return JSON.stringify(args);
    } catch {
      return String(args);
    }
  }

  #formatToolResult(block: ToolResultBlock): string {
    const text = block.rendered.map(contentBlockToText).join("");
    return text.length > 0 ? text : "(empty result)";
  }

  #formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  #fitLine(line: string, width: number): string {
    return truncateToWidth(line, width, "", true);
  }

  #requestRender(): void {
    if (!this.#stopped) {
      this.#tui.requestRender();
    }
  }
}
