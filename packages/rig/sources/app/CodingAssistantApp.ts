/* eslint-disable no-control-regex -- Terminal rendering intentionally parses ANSI controls. */
import { createId } from "@paralleldrive/cuid2";
import { homedir } from "node:os";
import { join } from "node:path";
import {
    CURSOR_MARKER,
    Editor,
    matchesKey,
    truncateToWidth,
    visibleWidth,
    wrapTextWithAnsi,
    type AutocompleteItem,
    type Component,
    type Focusable,
    type TUI,
} from "@earendil-works/pi-tui";

import {
    type AgentLoopEvent,
    type ContentBlock,
    type Message,
    type Skill,
    type ToolResultBlock,
    type UserMessage,
    formatSkillInvocation,
    loadSkills,
} from "../agent/index.js";
import type { BashSessionActivity } from "../agent/context/BashContext.js";
import { parseSkillFrontmatter } from "../agent/skills/parseSkillFrontmatter.js";
import type { FileDiff } from "../agent/ToolResultPresentation.js";
import { errorToMessage } from "../errorToMessage.js";
import type { NativeProxessManager } from "../processes/index.js";
import { humanizeMcpName } from "../mcp/humanizeMcpName.js";
import type { ServiceTier, Usage } from "../providers/types.js";
import type {
    FileSearchResult,
    EventId,
    McpServerSummary,
    SecretSummary,
    SessionEvent,
    SessionTask,
    SteerMessageResponse,
    SubagentSummary,
    WorkflowRun,
} from "../protocol/index.js";
import type { SecretAttachmentScope, SecretRegistration } from "../secrets/index.js";
import type { UserInputRequest, UserInputResponse } from "../user-input/index.js";
import { humanizeWorkflowName } from "../workflows/index.js";
import { createCodeReviewPrompt } from "../review/index.js";
import type { AppTranscriptEntry } from "./AppTranscriptEntry.js";
import type { CodexMcpToolCall } from "./CodexMcpToolCall.js";
import { CODEX_DARK_DIFF_PALETTE, CODEX_LIGHT_DIFF_PALETTE } from "./CodexFileDiff.js";
import type {
    CodingAssistantAgentBackend,
    CodingAssistantModelChoice,
} from "./CodingAssistantAgentBackend.js";
import { createEditorTheme } from "./createEditorTheme.js";
import { createSelectionPanel } from "./createSelectionPanel.js";
import { createWorkflowMonitor } from "./createWorkflowMonitor.js";
import { containsMarkdownTable } from "./containsMarkdownTable.js";
import { DEFAULT_TERMINAL_THEME } from "./defaultTerminalTheme.js";
import { createSlashCommands, type SlashCommandItem } from "./createSlashCommands.js";
import { describeModelChoice } from "./describeModelChoice.js";
import { describeReasoningLevel } from "./describeReasoningLevel.js";
import { encodeModelChoice } from "./encodeModelChoice.js";
import { formatActivityElapsedTime } from "./formatActivityElapsedTime.js";
import { formatCompactTokens as formatTokens } from "./formatCompactTokens.js";
import { formatCodexMcpToolResult } from "./formatCodexMcpToolResult.js";
import { FileMentionAutocomplete } from "./FileMentionAutocomplete.js";
import type { FileMentionContext } from "./findFileMentionContext.js";
import { formatFileMention } from "./formatFileMention.js";
import { formatSubagentRows } from "./formatSubagentRows.js";
import { formatSessionUsageSummary } from "./formatSessionUsageSummary.js";
import { formatToolResultForDisplay } from "./formatToolResultForDisplay.js";
import { humanizeReasoningLevel } from "./humanizeReasoningLevel.js";
import { humanizePermissionMode } from "./humanizePermissionMode.js";
import { humanizeProviderId } from "./humanizeProviderId.js";
import { humanizeGoalStatus } from "./humanizeGoalStatus.js";
import { humanizeToolName } from "./humanizeToolName.js";
import { parseCodexMcpToolInvocation } from "./parseCodexMcpToolInvocation.js";
import {
    readClipboardImage,
    type ClipboardImage,
    type ReadClipboardImageOptions,
} from "./readClipboardImage.js";
import { ACTIVITY_WAVE_FRAME_COUNT, renderActivityWave } from "./renderActivityWave.js";
import { AppendOnlyStreamingRender } from "./AppendOnlyStreamingRender.js";
import { renderAgentMarkdown } from "./renderAgentMarkdown.js";
import { renderBackgroundTerminalCompletion } from "./renderBackgroundTerminalCompletion.js";
import { renderBackgroundTerminalInteraction } from "./renderBackgroundTerminalInteraction.js";
import { renderBackgroundTerminalSummary } from "./renderBackgroundTerminalSummary.js";
import { renderChildRows, type ChildRow } from "./renderChildRows.js";
import { renderCodexFileDiff } from "./renderCodexFileDiff.js";
import { renderCodexMcpToolCall } from "./renderCodexMcpToolCall.js";
import { renderNoticeWithChildren } from "./renderNoticeWithChildren.js";
import { renderExecCommand } from "./renderExecCommand.js";
import { renderPendingSteeringMessages } from "./renderPendingSteeringMessages.js";
import { renderRigBanner } from "./renderRigBanner.js";
import { renderStartupStatusCard } from "./renderStartupStatusCard.js";
import { sanitizeTerminalText } from "./sanitizeTerminalText.js";
import { subagentElapsedMs } from "./subagentElapsedMs.js";
import { renderSubagentSummary } from "./renderSubagentSummary.js";
import { renderTurnCompletionSeparator } from "./renderTurnCompletionSeparator.js";
import { renderWorkflowSummary } from "./renderWorkflowSummary.js";
import { TranscriptEntryRenderCache } from "./TranscriptEntryRenderCache.js";
import { upsertSubagentSummary } from "./upsertSubagentSummary.js";
import { applyWorkflowRunUpdate } from "./applyWorkflowRunUpdate.js";
import type { TerminalTheme } from "./TerminalTheme.js";
import type { StartupStatusCardModel } from "./StartupStatusCardModel.js";
import { SecretMenuController } from "./SecretMenuController.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NOT_BOLD_OR_DIM = "\x1b[22m";
const CURSOR_BG = "\x1b[48;5;244m";
const CURSOR_FG = "\x1b[38;5;232m";
const INPUT_PLACEHOLDER = "Ask Rig to do anything";
const INPUT_PROMPT = "› ";
const INPUT_LINE_INDENT = "  ";
const PENDING_TOOL_CALL_TITLE = "Working";
const DOUBLE_ESCAPE_WINDOW_MS = 750;
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
const FAST_MODE_ON_MESSAGE = "Fast mode is on. Fast inference uses 2× plan usage.";
const FAST_MODE_OFF_MESSAGE = "Fast mode is off.";

const MAX_DIFF_FILES_PER_TOOL = 20;
const MAX_DIFF_ROWS_PER_TOOL = 120;

export interface CodingAssistantAppOptions {
    activeAgentLabel?: string;
    agent: CodingAssistantAgentBackend;
    attachSecret?: (id: string, scope: SecretAttachmentScope) => void | Promise<void>;
    cwd: string;
    initialBackgroundProcesses?: readonly BashSessionActivity[];
    initialMcpServers?: readonly McpServerSummary[];
    initialNotices?: readonly { text: string; title: string }[];
    initialSessionEvents?: readonly SessionEvent[];
    initialSubagents?: readonly SubagentSummary[];
    initialProjectSecretIds?: readonly string[];
    initialSessionSecretIds?: readonly string[];
    initialTasks?: readonly SessionTask[];
    initialWorkflowEventId?: EventId;
    initialWorkflows?: readonly WorkflowRun[];
    workflowsEnabled?: boolean;
    initialUserInputs?: readonly UserInputRequest[];
    modelLocked?: boolean;
    listSecrets?: () => readonly SecretSummary[] | Promise<readonly SecretSummary[]>;
    processManager: NativeProxessManager;
    sessionBacked?: boolean;
    tui: TUI;
    idFactory?: () => string;
    onDefaultModelChange?: (preference: DefaultModelPreference) => void | Promise<void>;
    onUserActivity?: () => void;
    onSettingsChange?: (settings: AppSettings) => void | Promise<void>;
    onStopWorkflow?: (runId: string) => void | Promise<void>;
    onExit?: () => void | Promise<void>;
    respondUserInput?: (requestId: string, response: UserInputResponse) => void | Promise<void>;
    now?: () => number;
    readClipboardImage?: (
        options?: ReadClipboardImageOptions,
    ) => Promise<ClipboardImage | undefined>;
    searchFiles?: (query: string) => Promise<readonly FileSearchResult[]>;
    completionChime?: boolean;
    registerSecret?: (registration: SecretRegistration) => SecretSummary | Promise<SecretSummary>;
    unregisterSecret?: (id: string) => boolean | Promise<boolean>;
    detachSecret?: (id: string, scope: SecretAttachmentScope) => void | Promise<void>;
    durableGlobalEventQueue?: boolean;
    showReasoning?: boolean;
    showUsage?: boolean;
    startupStatus?: StartupStatusCardModel;
    version?: string;
    theme?: TerminalTheme;
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

export interface DefaultModelPreference {
    effort: string;
    modelId: string;
    providerId: string;
    serviceTier: ServiceTier | null;
}

export interface AppSettings {
    completionChime: boolean;
    durableGlobalEventQueue: boolean;
    showReasoning: boolean;
    showUsage: boolean;
}

interface PendingPrompt {
    content: string | readonly ContentBlock[];
    displayText: string;
    transcriptAppended?: boolean;
}

interface PendingSteeringMessage {
    displayText: string;
    id: string;
    runId: string;
    transcriptIndex: number;
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

interface LocalSteeringSubmission {
    accepted: boolean;
    applied: boolean;
    id: number;
    invalidated: boolean;
    messageId: string;
    runEnded: boolean;
    runId: string;
    submission: PromptSubmission;
}

interface SteeringInterruptIntent {
    runId: string;
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
    readonly #activeAgentLabel: string | undefined;
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
    readonly #onUserActivity: (() => void) | undefined;
    readonly #onStopWorkflow: ((runId: string) => void | Promise<void>) | undefined;
    readonly #onExit: (() => void | Promise<void>) | undefined;
    readonly #respondUserInput:
        | ((requestId: string, response: UserInputResponse) => void | Promise<void>)
        | undefined;
    readonly #processManager: NativeProxessManager;
    readonly #readClipboardImage: (
        options?: ReadClipboardImageOptions,
    ) => Promise<ClipboardImage | undefined>;
    readonly #tui: TUI;
    readonly #theme: TerminalTheme;
    readonly #startupStatus: StartupStatusCardModel;
    readonly #secretMenu: SecretMenuController;
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
    #cursorVisible = true;
    #entries: AppTranscriptEntry[] = [];
    readonly #assistantStreamingRender = new AppendOnlyStreamingRender<AppTranscriptEntry>();
    readonly #thinkingStreamingRender = new AppendOnlyStreamingRender<AppTranscriptEntry>();
    readonly #entryRenderCache = new TranscriptEntryRenderCache();
    readonly #headerLinesByWidth = new Map<number, readonly string[]>();
    #exiting = false;
    #exitResolve: (() => void) | undefined;
    #focused = false;
    #terminalFocused = true;
    #freeformUserInput: FreeformUserInput | undefined;
    #pendingPrompts: PendingPrompt[] = [];
    #pendingSteeringMessages: PendingSteeringMessage[] = [];
    #inFlightSteeringSubmissions = new Map<number, LocalSteeringSubmission>();
    #acceptedSteeringSubmissions: LocalSteeringSubmission[] = [];
    #rejectedSteeringSubmissions = new Map<number, LocalSteeringSubmission>();
    #continuationRequestedSteeringMessageIds = new Set<string>();
    #nextSteeringSubmissionId = 1;
    #steeringInterruptIntent: SteeringInterruptIntent | undefined;
    #activeSessionRunId: string | undefined;
    #interruptRequestInFlight = false;
    #interruptSettlementRunId: string | undefined;
    #lastEscapeAtMs: number | undefined;
    #compacting = false;
    #pastedImagesById = new Map<number, PastedImage>();
    #selectionPanel: Component | undefined;
    #sessionMutationInFlight = false;
    #activeSessionMutation: Promise<void> | undefined;
    #sessionMutationBoundaryApplied = false;
    #ignoredBoundaryRunIds = new Set<string>();
    #dismissedSlashCommandText: string | undefined;
    #activeSubmissions = new Set<Promise<void>>();
    #bracketedPasteBuffer: string | undefined;
    #backgroundProcesses: readonly BashSessionActivity[] = [];
    #observedShellProcesses: readonly BashSessionActivity[] = [];
    #yieldedBackgroundTerminals = new Map<number, string>();
    #completionChime: boolean;
    #durableGlobalEventQueue: boolean;
    #showReasoning: boolean;
    #showUsage: boolean;
    #sessionBacked: boolean;
    #modelLocked: boolean;
    #mcpServers: readonly McpServerSummary[];
    #slashCommandSelectionIndex = 0;
    readonly #slashCommands: readonly SlashCommandItem[];
    #skillCommands: SlashCommandItem[] = [];
    #skillCommandsLoaded = false;
    #skillCommandsRefresh: Promise<void> | undefined;
    #skillsByName = new Map<string, Skill>();
    #imagePasteInFlight: Promise<void> | undefined;
    #nextPastedImageId = 1;
    #runToken = 0;
    #terminalResizeTranscriptEntries: AppTranscriptEntry[] | undefined;
    #running = false;
    #activeToolCallIds = new Set<string>();
    #awaitingApprovalToolCallIds = new Set<string>();
    #stoppedToolCallIds = new Set<string>();
    #seenToolCallIds = new Set<string>();
    #statusText = "Idle";
    #stopped = false;
    #streamEntryId: string | undefined;
    #subagents: readonly SubagentSummary[];
    #subagentRefreshTimer: ReturnType<typeof setInterval> | undefined;
    #tasks: readonly SessionTask[];
    #thinkingEntryIdsByContentIndex = new Map<number, string>();
    #toolCallEntryIdsByContentIndex = new Map<number, string>();
    #streamedToolCallEntries = new Set<AppTranscriptEntry>();
    #streamingThinkingEntryIds = new Set<string>();
    #deferredTurnSeparator = false;
    #workSegmentStartedAtMs: number | undefined;
    #pendingSubagentCompletionIds = new Set<string>();
    #recordedSubagentCompletionIds = new Set<string>();
    #renderedCompletionNotices = new Map<string, number>();
    #runningToolCallIds = new Set<string>();
    #stoppingBackgroundTerminals = false;
    #toolStatusByCallId = new Map<string, string>();
    #usage: Usage = zeroUsage();
    #usageRequestVersion = 0;
    #latestContextTokens = 0;
    #lastUserInputAtMs: number | undefined;
    #userInputRequests: UserInputRequest[] = [];
    #workflows: readonly WorkflowRun[];
    #workflowsEnabled: boolean;
    #replayingInitialSessionEvents = false;

    constructor(options: CodingAssistantAppOptions) {
        this.#activeAgentLabel =
            options.activeAgentLabel === undefined
                ? undefined
                : this.#singleLine(options.activeAgentLabel);
        this.#agent = options.agent;
        this.#cwd = options.cwd;
        this.#idFactory = options.idFactory ?? createId;
        this.#now = options.now ?? Date.now;
        this.#onDefaultModelChange = options.onDefaultModelChange;
        this.#onSettingsChange = options.onSettingsChange;
        this.#onUserActivity = options.onUserActivity;
        this.#onStopWorkflow = options.onStopWorkflow;
        this.#onExit = options.onExit;
        this.#respondUserInput = options.respondUserInput;
        this.#processManager = options.processManager;
        this.#readClipboardImage = options.readClipboardImage ?? readClipboardImage;
        this.#sessionBacked = options.sessionBacked ?? false;
        this.#completionChime = options.completionChime ?? false;
        this.#durableGlobalEventQueue = options.durableGlobalEventQueue ?? false;
        this.#showReasoning = options.showReasoning ?? false;
        this.#showUsage = options.showUsage ?? false;
        this.#modelLocked = options.modelLocked ?? !options.agent.canChangeModel;
        this.#mcpServers = options.initialMcpServers ?? [];
        this.#subagents = options.initialSubagents ?? [];
        this.#tasks = options.initialTasks ?? [];
        this.#workflows = options.initialWorkflows ?? [];
        this.#workflowsEnabled = options.workflowsEnabled ?? true;
        this.#slashCommands = createSlashCommands({ workflowsEnabled: this.#workflowsEnabled });
        this.#tui = options.tui;
        this.#theme = { ...(options.theme ?? DEFAULT_TERMINAL_THEME) };
        this.#secretMenu = new SecretMenuController({
            appendEntry: (entry) => this.#appendEntry(entry),
            attachSecret: options.attachSecret,
            closePanel: () => this.#setSelectionPanel(undefined),
            detachSecret: options.detachSecret,
            initialProjectSecretIds: options.initialProjectSecretIds,
            initialSessionSecretIds: options.initialSessionSecretIds,
            listSecrets: options.listSecrets,
            registerSecret: options.registerSecret,
            requestRender: () => this.#requestRender(),
            showPanel: (component) => this.#setSelectionPanel(component),
            theme: this.#theme,
            unregisterSecret: options.unregisterSecret,
        });
        this.#version = options.version ?? "0.0.0";
        const snapshot = options.agent.snapshot();
        const startupStatus: StartupStatusCardModel = {
            access: humanizePermissionMode(options.agent.permissionMode),
            environment: "Local",
            fast: snapshot.serviceTier === "fast",
            model: options.agent.model.name,
            provider: humanizeProviderId(options.agent.provider.id),
            reasoning: humanizeReasoningLevel(
                snapshot.effort ?? options.agent.model.defaultThinkingLevel,
            ),
            session: "New session",
            version: this.#version,
            workspace: options.cwd,
            ...options.startupStatus,
        };
        this.#startupStatus = {
            ...startupStatus,
            ...(startupStatus.usage === undefined
                ? {}
                : {
                      usage: {
                          ...(startupStatus.usage.fiveHour === undefined
                              ? {}
                              : { fiveHour: { ...startupStatus.usage.fiveHour } }),
                          ...(startupStatus.usage.weekly === undefined
                              ? {}
                              : { weekly: { ...startupStatus.usage.weekly } }),
                      },
                  }),
        };
        this.#editor = new Editor(this.#tui, createEditorTheme(this.#theme), { paddingX: 0 });
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

        for (const notice of options.initialNotices ?? []) {
            this.#appendEntry({ role: "event", text: notice.text, title: notice.title });
        }

        this.#replayingInitialSessionEvents = true;
        try {
            let reachedInitialSnapshot = options.initialWorkflowEventId === undefined;
            for (const event of options.initialSessionEvents ?? []) {
                // The snapshot is authoritative through its last event. Apply only state events
                // that raced in after it so persisted history cannot overwrite current state.
                if (
                    (event.type === "workflow_changed" || event.type === "secrets_changed") &&
                    !reachedInitialSnapshot
                ) {
                    if (event.id === options.initialWorkflowEventId) reachedInitialSnapshot = true;
                    continue;
                }
                if (event.id === options.initialWorkflowEventId) reachedInitialSnapshot = true;
                this.applySessionEvent(event);
            }
        } finally {
            this.#replayingInitialSessionEvents = false;
        }
        this.#observedShellProcesses = options.initialBackgroundProcesses ?? [];
        this.#backgroundProcesses = this.#observedShellProcesses;
        for (const process of this.#observedShellProcesses) {
            this.#yieldedBackgroundTerminals.set(process.sessionId, process.command);
        }
        this.#syncSubagentRefreshTimer();

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
        this.#stopSubagentRefreshTimer();
        this.#stopCursorBlink();
        this.#activeToolCallIds.clear();
        this.#awaitingApprovalToolCallIds.clear();
        this.#runningToolCallIds.clear();
        this.#toolStatusByCallId.clear();
        this.#fileMentionAutocomplete?.clear();
        this.#editor.setText("");
        this.#discardLocalSteeringSubmissionsForBoundary();
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
        const eventRunId = this.#sessionEventRunId(event);
        if (
            event.type !== "session_reset" &&
            event.type !== "session_rewound" &&
            eventRunId !== undefined &&
            this.#ignoredBoundaryRunIds.has(eventRunId)
        ) {
            return;
        }
        if (event.type === "message_submitted") {
            this.#modelLocked = true;
            const notificationPrefix = "Background work ";
            if (event.data.source === "notification") {
                if (this.#consumeRenderedCompletionNotice(event.data.displayText)) return;
            } else if (event.data.delivery === "steer") {
                const localSteering = this.#localSteeringSubmission(event.data.message.id);
                if (localSteering !== undefined) {
                    localSteering.accepted = true;
                    localSteering.runId = event.data.runId;
                }
                if (this.#steeringInterruptIntent?.runId === event.data.runId) {
                    this.#tryRequestSteeringInterrupt(event.data.runId);
                }
                this.#recordUserInput(event.createdAt);
                if (
                    !this.#pendingSteeringMessages.some(
                        (pending) => pending.id === event.data.message.id,
                    )
                ) {
                    this.#pendingSteeringMessages.push({
                        displayText: event.data.displayText,
                        id: event.data.message.id,
                        runId: event.data.runId,
                        transcriptIndex:
                            this.#entries.length + this.#pendingSteeringMessages.length,
                    });
                }
                this.#requestRender();
                return;
            } else {
                this.#recordUserInput(event.createdAt);
            }
            this.#appendEntry({
                ...(event.data.source === "notification" ? { childText: true } : {}),
                id: event.data.message.id,
                role: event.data.source === "notification" ? "event" : "user",
                text:
                    event.data.source === "notification" &&
                    event.data.displayText.startsWith(notificationPrefix)
                        ? event.data.displayText.slice(notificationPrefix.length)
                        : event.data.displayText,
                ...(event.data.source === "notification" ? { title: "Background work" } : {}),
            });
            return;
        }

        if (event.type === "steering_applied") {
            for (const messageId of event.data.messageIds) {
                const localSteering = this.#localSteeringSubmission(messageId);
                if (localSteering !== undefined) localSteering.applied = true;
            }
            this.#promotePendingSteeringMessages(event.data.messageIds);
            if (this.#steeringInterruptIntent?.runId === event.data.runId) {
                this.#tryRequestSteeringInterrupt(event.data.runId);
            }
            return;
        }

        if (event.type === "run_started") {
            this.#usageRequestVersion += 1;
            this.#abortNotified = false;
            this.#activeSessionRunId = event.data.runId;
            this.#setRunning(true);
            this.#statusText = "Running";
            this.#activityStartedAtMs = this.#lastUserInputAtMs ?? this.#now();
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
            const blockedServers = event.data.servers.filter(
                (server) => server.status === "blocked",
            );
            if (blockedServers.length > 0) {
                this.#appendEntry({
                    role: "event",
                    title:
                        blockedServers.length === 1 ? "MCP server blocked" : "MCP servers blocked",
                    text: "",
                    noticeChildren: blockedServers.map((server) => ({
                        label: humanizeMcpName(server.name, "MCP server"),
                        reason:
                            server.errorMessage ??
                            "This server is blocked by the current security boundary.",
                    })),
                });
            }
            this.#requestRender();
            return;
        }

        if (event.type === "tasks_changed") {
            this.#tasks = event.data.tasks;
            this.#requestRender();
            return;
        }

        if (event.type === "secrets_changed") {
            this.#secretMenu.updateAttachments(
                event.data.projectSecretIds,
                event.data.sessionSecretIds,
            );
            this.#requestRender();
            return;
        }

        if (event.type === "subagent_changed") {
            const previous = this.#subagents.find(
                (subagent) => subagent.id === event.data.subagent.id,
            );
            this.#subagents = upsertSubagentSummary(this.#subagents, event.data.subagent);
            if (this.#isActiveSubagent(event.data.subagent)) {
                this.#recordedSubagentCompletionIds.delete(event.data.subagent.id);
            }
            const becameInactive =
                previous !== undefined &&
                this.#isActiveSubagent(previous) &&
                !this.#isActiveSubagent(event.data.subagent);
            const hasActiveDescendant = this.#hasActiveSubagentDescendant(event.data.subagent.id);
            if (becameInactive && hasActiveDescendant) {
                this.#pendingSubagentCompletionIds.add(event.data.subagent.id);
            }
            if (
                previous !== undefined &&
                !this.#isActiveSubagent(event.data.subagent) &&
                !this.#recordedSubagentCompletionIds.has(event.data.subagent.id) &&
                !hasActiveDescendant &&
                (becameInactive || this.#pendingSubagentCompletionIds.has(event.data.subagent.id))
            ) {
                this.#pendingSubagentCompletionIds.delete(event.data.subagent.id);
                if (event.data.subagent.status !== "suspended") {
                    this.#recordedSubagentCompletionIds.add(event.data.subagent.id);
                }
                this.#recordSubagentCompletion(event.data.subagent);
            }
            this.#syncSubagentRefreshTimer();
            this.#requestRender();
            return;
        }

        if (event.type === "subagents_suspended") {
            this.#appendEntry({
                role: "event",
                title: "Subagents suspended",
                text: event.data.displayText,
            });
            return;
        }

        if (event.type === "workflow_changed") {
            const previous = this.#workflows.find(
                (workflow) => workflow.runId === event.data.update.runId,
            );
            this.#workflows = applyWorkflowRunUpdate(this.#workflows, event.data.update);
            const next = this.#workflows.find(
                (workflow) => workflow.runId === event.data.update.runId,
            );
            if (previous?.status === "running" && next !== undefined && next.status !== "running") {
                this.#recordWorkflowCompletion(next);
            }
            this.#requestRender();
            return;
        }

        if (event.type === "run_finished") {
            this.#finishLocalSteeringRun(event.data.runId);
            const turnElapsedMs =
                event.data.stopReason === "stop"
                    ? this.#elapsedSinceLastUserInput(event.createdAt)
                    : undefined;
            if (event.data.stopReason === "aborted") {
                this.#appendAbortNotice();
            } else if (event.data.stopReason !== "stop") {
                this.#deferredTurnSeparator = false;
                this.#workSegmentStartedAtMs = undefined;
            }
            this.#discardPendingToolCallEntries();
            if (this.#activeSessionRunId === event.data.runId) {
                this.#activeSessionRunId = undefined;
            }
            if (this.#interruptSettlementRunId === event.data.runId) {
                this.#interruptSettlementRunId = undefined;
            }
            this.#setRunning(false);
            this.#modelLocked = this.#pendingPrompts.length > 0;
            this.#statusText =
                event.data.stopReason === "stop" ? "Idle" : `Stopped: ${event.data.stopReason}`;
            this.#stopActivityAnimation();
            this.#streamEntryId = undefined;
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#streamingThinkingEntryIds.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
            this.#markActiveToolCallsStopped();
            this.#activeToolCallIds.clear();
            this.#awaitingApprovalToolCallIds.clear();
            this.#runningToolCallIds.clear();
            this.#toolStatusByCallId.clear();
            this.#clearUserInputRequests();
            if (turnElapsedMs !== undefined) this.#appendTurnCompletion(turnElapsedMs);
            this.#startDrainQueue();
            this.#requestRender();
            return;
        }

        if (event.type === "run_error") {
            this.#finishLocalSteeringRun(event.data.runId);
            this.#deferredTurnSeparator = false;
            this.#workSegmentStartedAtMs = undefined;
            this.#discardPendingToolCallEntries();
            if (this.#activeSessionRunId === event.data.runId) {
                this.#activeSessionRunId = undefined;
            }
            if (this.#interruptSettlementRunId === event.data.runId) {
                this.#interruptSettlementRunId = undefined;
            }
            this.#setRunning(false);
            this.#modelLocked = this.#pendingPrompts.length > 0;
            this.#statusText = "Error";
            this.#stopActivityAnimation();
            this.#markActiveToolCallsStopped();
            this.#activeToolCallIds.clear();
            this.#awaitingApprovalToolCallIds.clear();
            this.#runningToolCallIds.clear();
            this.#toolStatusByCallId.clear();
            this.#clearUserInputRequests();
            this.#appendEntry({ role: "error", text: event.data.errorMessage });
            this.#startDrainQueue();
            return;
        }

        if (event.type === "session_reset") {
            this.#usageRequestVersion += 1;
            if (this.#activeSessionRunId !== undefined) {
                this.#ignoredBoundaryRunIds.add(this.#activeSessionRunId);
            }
            const discardedQueuedPrompts = this.#discardLocalPromptsForBoundary();
            this.#sessionMutationBoundaryApplied = true;
            this.#lastEscapeAtMs = undefined;
            this.#activeSessionRunId = undefined;
            this.#interruptSettlementRunId = undefined;
            this.#setRunning(false);
            this.#clearEntries();
            this.#pendingSteeringMessages = [];
            this.#modelLocked = false;
            this.#seenToolCallIds.clear();
            this.#streamEntryId = undefined;
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#streamingThinkingEntryIds.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
            this.#activeToolCallIds.clear();
            this.#awaitingApprovalToolCallIds.clear();
            this.#runningToolCallIds.clear();
            this.#toolStatusByCallId.clear();
            this.#usage = zeroUsage();
            this.#latestContextTokens = 0;
            this.#lastUserInputAtMs = undefined;
            this.#workflows = [];
            this.#backgroundProcesses = [];
            this.#observedShellProcesses = [];
            this.#yieldedBackgroundTerminals.clear();
            this.#renderedCompletionNotices.clear();
            this.#clearUserInputRequests();
            this.#appendEntry({
                role: "system",
                text:
                    discardedQueuedPrompts > 0
                        ? "Session reset. Started a new session. Queued input was saved to input history."
                        : "Session reset. Started a new session.",
            });
            return;
        }

        if (event.type === "session_rewound") {
            this.#usageRequestVersion += 1;
            if (this.#activeSessionRunId !== undefined) {
                this.#ignoredBoundaryRunIds.add(this.#activeSessionRunId);
            }
            const discardedQueuedPrompts = this.#discardLocalPromptsForBoundary();
            this.#sessionMutationBoundaryApplied = true;
            this.#lastEscapeAtMs = undefined;
            this.#activeSessionRunId = undefined;
            this.#interruptSettlementRunId = undefined;
            this.#setRunning(false);
            this.#pendingSteeringMessages = [];
            const targetIndex = this.#entries.findIndex(
                (entry) => entry.id === event.data.messageId,
            );
            if (targetIndex >= 0) this.#entries = this.#entries.slice(0, targetIndex);
            this.#modelLocked = false;
            this.#statusText = "Idle";
            this.#streamEntryId = undefined;
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#streamingThinkingEntryIds.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
            this.#activeToolCallIds.clear();
            this.#awaitingApprovalToolCallIds.clear();
            this.#runningToolCallIds.clear();
            this.#toolStatusByCallId.clear();
            this.#clearUserInputRequests();
            if (discardedQueuedPrompts > 0) {
                this.#appendEntry({
                    role: "system",
                    text: "Conversation rewound. Queued input was saved to input history.",
                });
            }
            this.#requestRender();
            return;
        }

        if (event.type === "session_title_changed") {
            return;
        }

        if (event.type === "model_changed") {
            this.#usageRequestVersion += 1;
            this.#latestContextTokens = 0;
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

        if (event.type === "service_tier_changed") {
            this.#appendEntry({
                role: "event",
                title: "fast",
                text:
                    event.data.serviceTier === "fast"
                        ? FAST_MODE_ON_MESSAGE
                        : FAST_MODE_OFF_MESSAGE,
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
            const activeSubmissions = [...this.#activeSubmissions];
            if (activeSubmissions.length > 0) {
                await Promise.all(activeSubmissions);
                continue;
            }

            const activeRun = this.#activeRun;
            if (activeRun !== undefined) {
                await activeRun;
                continue;
            }

            const sessionMutation = this.#activeSessionMutation;
            if (sessionMutation === undefined) return;
            await sessionMutation;
        }
    }

    handleInput(data: string): void {
        if (this.#stopped || this.#exiting) {
            return;
        }

        if (data === TERMINAL_FOCUS_IN || data === TERMINAL_FOCUS_OUT) {
            this.#lastEscapeAtMs = undefined;
            this.#setTerminalFocused(data === TERMINAL_FOCUS_IN);
            return;
        }

        const escapePressed = matchesKey(data, "escape");
        if (!escapePressed) this.#lastEscapeAtMs = undefined;
        this.#onUserActivity?.();

        if (this.#sessionMutationInFlight) {
            this.#requestRender();
            return;
        }

        if (escapePressed && this.#running) {
            this.#handleEscape();
            this.#requestRender();
            return;
        }

        if (this.#selectionPanel !== undefined) {
            if (matchesKey(data, "ctrl+c") || data === "\x03") {
                this.#selectionPanel.handleInput?.("\x1b");
                this.#requestRender();
                return;
            }
            this.#selectionPanel.handleInput?.(data);
            this.#lastEscapeAtMs = undefined;
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
                this.#lastEscapeAtMs = undefined;
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

        if (this.#running && escapePressed) {
            this.#handleEscape();
            this.#requestRender();
            return;
        }

        const previousFileMentionSuggestionCount = this.#fileMentionSnapshot()?.items.length ?? 0;
        if (this.#handleSlashCommandAutocompleteInput(data)) {
            this.#requestRender();
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
            this.#requestRender();
            return;
        }

        if (escapePressed) {
            this.#markTypingActivity();
            if (this.#editor.getText().trim().length > 0 || !this.#openBacktrackMenu()) {
                this.#handleEscape();
            }
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
        this.#requestRender();
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
                text: `Image paste failed: ${errorToMessage(error)}`,
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

    setTheme(theme: TerminalTheme): void {
        Object.assign(this.#theme, theme);
        this.invalidate();
        this.#requestRender();
    }

    render(width: number): string[] {
        const safeWidth = Math.max(1, width);
        const header = this.#renderHeader(safeWidth);
        const transcript = this.#renderTranscript(safeWidth);
        if (this.#exiting) return [...header, ...transcript];
        return [...header, ...transcript, ...this.#renderLiveTail(safeWidth)];
    }

    beginTerminalResize(): void {
        if (this.#terminalResizeTranscriptEntries !== undefined) return;
        this.#terminalResizeTranscriptEntries = this.#visibleTranscriptEntries().map((entry) => ({
            ...entry,
            ...(entry.fileDiffs === undefined ? {} : { fileDiffs: [...entry.fileDiffs] }),
            ...(entry.noticeChildren === undefined
                ? {}
                : { noticeChildren: [...entry.noticeChildren] }),
        }));
    }

    endTerminalResize(): void {
        this.#terminalResizeTranscriptEntries = undefined;
    }

    resizeLiveTailLineCount(width: number): number {
        return this.#exiting ? 0 : this.#renderLiveTail(Math.max(1, width)).length;
    }

    #renderLiveTail(width: number): string[] {
        const safeWidth = Math.max(1, width);
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
        const activeWork =
            this.#selectionPanel === undefined
                ? this.#renderActiveWorkList(safeWidth)
                : this.#renderActiveToolRows(safeWidth);
        const pendingSteering =
            this.#selectionPanel === undefined
                ? renderPendingSteeringMessages(
                      this.#pendingSteeringMessages.map((message) => message.displayText),
                      safeWidth,
                  )
                : [];
        const queuedPrompts =
            this.#selectionPanel === undefined ? this.#renderQueuedPrompts(safeWidth) : [];

        return [
            "",
            ...activeWork,
            ...(activeWork.length > 0 ? [""] : []),
            ...pendingSteering,
            ...(pendingSteering.length > 0 ? [""] : []),
            ...queuedPrompts,
            ...(queuedPrompts.length > 0 ? [""] : []),
            ...(this.#selectionPanel === undefined
                ? input
                : this.#selectionPanel.render(safeWidth)),
            ...footer,
            "",
        ];
    }

    #submit(value: string): void {
        if (this.#freeformUserInput !== undefined) {
            this.#submitFreeformUserInput(value);
            return;
        }
        const submission = this.#submitAsync(value).catch((error: unknown) => {
            this.#appendEntry({ role: "error", text: errorToMessage(error) });
        });
        const trackedSubmission = submission.finally(() => {
            this.#activeSubmissions.delete(trackedSubmission);
            this.#requestRender();
        });
        this.#activeSubmissions.add(trackedSubmission);
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
            this.#editor.addToHistory(prompt);
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

        this.#editor.addToHistory(prompt);

        if (!this.#sessionBacked) this.#recordUserInput(this.#now());
        this.#modelLocked = true;
        if (this.#running) {
            if (this.#sessionBacked && this.#activeSessionRunId === undefined) {
                this.#pendingPrompts.push(submission);
                this.#requestRender();
                return;
            }
            if (
                this.#interruptSettlementRunId !== undefined &&
                this.#interruptSettlementRunId === this.#activeSessionRunId
            ) {
                this.#pendingPrompts.push(submission);
                this.#requestRender();
                return;
            }
            const localSteering = this.#trackLocalSteeringSubmission(submission);
            try {
                const response = await this.#agent.steer(submission.content, {
                    ...(localSteering === undefined
                        ? {}
                        : { clientSubmissionId: localSteering.messageId }),
                    displayText: submission.displayText,
                    ...(localSteering === undefined ? {} : { expectedRunId: localSteering.runId }),
                });
                this.#settleLocalSteeringSubmission(localSteering, true, response);
            } catch (error) {
                if (localSteering?.invalidated === true) return;
                if (localSteering?.accepted === true) {
                    this.#settleLocalSteeringSubmission(localSteering, true);
                    return;
                }
                this.#settleLocalSteeringSubmission(localSteering, false);
                throw error;
            }
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
                text: errorToMessage(error),
            });
            return;
        }

        const expandedPrompt = formatSkillInvocation(
            skill,
            parseSkillFrontmatter(content).body,
            parsed[2] ?? "",
        );
        const submission: PromptSubmission = {
            content: expandedPrompt,
            displayText: prompt,
        };

        if (!this.#sessionBacked) this.#recordUserInput(this.#now());
        this.#modelLocked = true;
        if (this.#running) {
            if (this.#sessionBacked && this.#activeSessionRunId === undefined) {
                this.#pendingPrompts.push(submission);
                this.#requestRender();
                return;
            }
            const localSteering = this.#trackLocalSteeringSubmission(submission);
            try {
                const response = await this.#agent.steer(expandedPrompt, {
                    ...(localSteering === undefined
                        ? {}
                        : { clientSubmissionId: localSteering.messageId }),
                    displayText: prompt,
                    ...(localSteering === undefined ? {} : { expectedRunId: localSteering.runId }),
                });
                this.#settleLocalSteeringSubmission(localSteering, true, response);
            } catch (error) {
                if (localSteering?.invalidated === true) return;
                if (localSteering?.accepted === true) {
                    this.#settleLocalSteeringSubmission(localSteering, true);
                    return;
                }
                this.#settleLocalSteeringSubmission(localSteering, false);
                throw error;
            }
            if (!this.#sessionBacked) this.#appendEntry({ role: "user", text: prompt });
            return;
        }
        if (!this.#sessionBacked) {
            this.#appendEntry({ role: "user", text: prompt });
            submission.transcriptAppended = true;
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
    }

    #handleCommand(prompt: string): boolean {
        if (prompt === "/goal" || prompt.startsWith("/goal ")) {
            void this.#handleGoalCommand(prompt).catch((error: unknown) => {
                this.#appendEntry({ role: "error", text: errorToMessage(error) });
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

        if (prompt === "/fast" || prompt.startsWith("/fast ")) {
            this.#handleFastCommand(prompt);
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

        if (prompt === "/secrets") {
            this.#secretMenu.open();
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

        if (prompt === "/ps") {
            this.#showBackgroundTerminals();
            return true;
        }

        if (prompt === "/stop") {
            this.#stopBackgroundTerminals();
            return true;
        }

        if (prompt === "/workflows" || prompt === "/workflow") {
            if (this.#workflowsEnabled) {
                this.#openWorkflowMonitor();
            } else {
                this.#appendEntry({
                    role: "event",
                    text: "Workflows are disabled for this session.",
                    title: "Workflows",
                });
                this.#requestRender();
            }
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
            this.#streamingThinkingEntryIds.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
            this.#activeToolCallIds.clear();
            this.#awaitingApprovalToolCallIds.clear();
            this.#runningToolCallIds.clear();
            this.#toolStatusByCallId.clear();
            this.#appendEntry({ role: "system", text: "Transcript cleared." });
            return true;
        }

        if (prompt === "/abort") {
            if (!this.#abortActiveRun()) {
                void this.#abortIdleSession();
            }
            return true;
        }

        return false;
    }

    #handleFastCommand(prompt: string): void {
        if (!this.#supportsFastInference()) {
            this.#appendEntry({
                role: "error",
                text: `Fast inference is not available with ${this.#agent.model.name}.`,
            });
            return;
        }

        const argument = prompt.slice("/fast".length).trim().toLowerCase();
        const fastEnabled = this.#agent.snapshot().serviceTier === "fast";
        if (argument === "status") {
            this.#appendEntry({
                role: "event",
                title: "fast",
                text: fastEnabled ? "Fast mode is on." : FAST_MODE_OFF_MESSAGE,
            });
            return;
        }

        let serviceTier: ServiceTier | undefined;
        if (argument.length === 0) {
            serviceTier = fastEnabled ? undefined : "fast";
        } else if (argument === "on") {
            serviceTier = "fast";
        } else if (argument !== "off") {
            this.#appendEntry({ role: "error", text: "Usage: /fast [on|off|status]" });
            return;
        }

        const completeChange = () => {
            const effort = this.#agent.snapshot().effort ?? this.#agent.model.defaultThinkingLevel;
            this.#persistDefaultModel(
                this.#agent.model.id,
                effort,
                this.#agent.provider.id,
                this.#agent.confirmedServiceTier ?? null,
            );
            if (!this.#sessionBacked) {
                this.#appendEntry({
                    role: "event",
                    title: "fast",
                    text: serviceTier === "fast" ? FAST_MODE_ON_MESSAGE : FAST_MODE_OFF_MESSAGE,
                });
            }
            this.#requestRender();
        };
        try {
            const change = this.#agent.setServiceTier(serviceTier);
            if (change === undefined) {
                completeChange();
                return;
            }
            void change.then(completeChange).catch((error: unknown) => {
                this.#appendEntry({
                    role: "error",
                    text: `Could not turn fast mode ${serviceTier === "fast" ? "on" : "off"}: ${errorToMessage(error)}`,
                });
                this.#requestRender();
            });
        } catch (error) {
            this.#appendEntry({
                role: "error",
                text: `Could not turn fast mode ${serviceTier === "fast" ? "on" : "off"}: ${errorToMessage(error)}`,
            });
            this.#requestRender();
        }
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
                if (server.status === "blocked") {
                    return `${server.name}: blocked${server.errorMessage === undefined ? "" : ` — ${server.errorMessage}`}`;
                }
                return `${server.name}: could not connect${server.errorMessage === undefined ? "" : ` — ${server.errorMessage}`}`;
            })
            .join("\n");
        this.#appendEntry({ role: "event", title: "MCP servers", text });
    }

    #showUsageSummary(): void {
        if (this.#agent.getUsage !== undefined) {
            const version = ++this.#usageRequestVersion;
            void this.#agent
                .getUsage()
                .then((summary) => {
                    if (version !== this.#usageRequestVersion) return;
                    this.#appendEntry({
                        childText: true,
                        role: "event",
                        title: "Usage",
                        text: formatSessionUsageSummary(
                            summary,
                            this.#agent.modelChoices ?? [
                                { model: this.#agent.model, providerId: this.#agent.provider.id },
                            ],
                            this.#now(),
                        ),
                    });
                })
                .catch(() => {
                    if (version !== this.#usageRequestVersion) return;
                    this.#appendEntry({
                        role: "event",
                        title: "Usage",
                        text: "Usage unavailable.",
                    });
                });
            return;
        }

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
        this.#appendEntry({
            childText: true,
            role: "event",
            title: "Subagents",
            text: formatSubagentRows(this.#subagents, this.#now()).join("\n"),
        });
    }

    #showBackgroundTerminals(): void {
        this.#appendEntry({
            role: "event",
            title: "Background terminals",
            text:
                this.#backgroundProcesses.length === 0
                    ? "No background terminals running."
                    : this.#backgroundProcesses
                          .map((process) => `• ${process.command}\n  ${process.cwd}`)
                          .join("\n"),
        });
    }

    #stopBackgroundTerminals(): void {
        this.#appendEntry({
            role: "event",
            title: "Background terminals",
            text: "Stopping all background terminals.",
        });
        this.#stoppingBackgroundTerminals = true;
        const stop =
            this.#agent.stopBackgroundProcesses === undefined
                ? (this.#agent.context.bash.killAllSessions?.() ?? Promise.resolve(0))
                : this.#agent.stopBackgroundProcesses();
        void stop
            .then(() => {
                this.#backgroundProcesses = [];
                this.#yieldedBackgroundTerminals.clear();
                this.#requestRender();
            })
            .catch((error: unknown) => {
                this.#appendEntry({
                    role: "error",
                    title: "Background terminals",
                    text: errorToMessage(error),
                });
                this.#requestRender();
            })
            .finally(() => {
                this.#stoppingBackgroundTerminals = false;
            });
    }

    #openWorkflowMonitor(initialRunId?: string): void {
        this.#showSelectionPanel(
            createWorkflowMonitor({
                theme: this.#theme,
                getSubagents: () => this.#subagents,
                getWorkflows: () => this.#workflows,
                ...(initialRunId === undefined ? {} : { initialRunId }),
                now: this.#now,
                onCancel: () => this.#closeSelectionPanel(),
                onRequestRender: () => this.#requestRender(),
                onStop: async (runId) => {
                    if (this.#onStopWorkflow === undefined) {
                        this.#appendEntry({
                            role: "event",
                            text: "Workflow controls are unavailable in this session.",
                            title: "Workflows",
                        });
                        this.#closeSelectionPanel();
                        return;
                    }
                    try {
                        await this.#onStopWorkflow(runId);
                    } catch (error) {
                        this.#appendEntry({
                            role: "error",
                            text: errorToMessage(error),
                            title: "Workflow",
                        });
                        this.#closeSelectionPanel();
                    }
                },
            }),
        );
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
        if (this.#sessionMutationInFlight) return;
        this.#usageRequestVersion += 1;
        const discardedQueuedPrompts = this.#discardLocalPromptsForBoundary();
        if (this.#activeSessionRunId !== undefined) {
            this.#ignoredBoundaryRunIds.add(this.#activeSessionRunId);
        }
        this.#sessionMutationInFlight = true;
        this.#sessionMutationBoundaryApplied = false;
        this.#lastEscapeAtMs = undefined;
        this.#statusText = "Resetting session";
        this.#requestRender();
        const mutation = Promise.resolve(this.#agent.reset())
            .then(() => {
                if (!this.#sessionMutationBoundaryApplied) {
                    this.#clearEntries();
                    this.#modelLocked = false;
                    this.#seenToolCallIds.clear();
                    this.#streamEntryId = undefined;
                    this.#thinkingEntryIdsByContentIndex.clear();
                    this.#streamingThinkingEntryIds.clear();
                    this.#toolCallEntryIdsByContentIndex.clear();
                    this.#activeToolCallIds.clear();
                    this.#awaitingApprovalToolCallIds.clear();
                    this.#runningToolCallIds.clear();
                    this.#toolStatusByCallId.clear();
                    this.#usage = zeroUsage();
                    this.#latestContextTokens = 0;
                    this.#lastUserInputAtMs = undefined;
                    this.#abortNotified = false;
                    this.#statusText = "Idle";
                    this.#appendEntry({
                        role: "system",
                        text:
                            discardedQueuedPrompts > 0
                                ? "Session reset. Started a new session. Queued input was saved to input history."
                                : "Session reset. Started a new session.",
                    });
                }
            })
            .catch((error: unknown) => {
                this.#statusText = "Error";
                this.#appendEntry({
                    role: "error",
                    text: `The session could not be reset: ${errorToMessage(error)}`,
                });
            })
            .finally(() => {
                this.#sessionMutationInFlight = false;
                if (this.#activeSessionMutation === mutation) {
                    this.#activeSessionMutation = undefined;
                }
                this.#requestRender();
            });
        this.#activeSessionMutation = mutation;
    }

    #startDrainQueue(): void {
        if (
            this.#activeRun !== undefined ||
            this.#compacting ||
            this.#interruptRequestInFlight ||
            this.#running ||
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
            const prompt = this.#pendingPrompts[0];
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
        this.#setRunning(true);
        this.#statusText = "Running";
        this.#streamEntryId = undefined;
        this.#thinkingEntryIdsByContentIndex.clear();
        this.#streamingThinkingEntryIds.clear();
        this.#toolCallEntryIdsByContentIndex.clear();
        this.#activeToolCallIds.clear();
        this.#awaitingApprovalToolCallIds.clear();
        this.#runningToolCallIds.clear();
        this.#toolStatusByCallId.clear();
        this.#activityStartedAtMs = this.#lastUserInputAtMs ?? this.#now();
        this.#startActivityAnimation();
        this.#requestRender();

        let turnCompleted = false;
        try {
            await this.#refreshSkillCommands({ force: true });
            if (!this.#isCurrentRun(runToken)) {
                return;
            }

            if (this.#pendingPrompts[0] !== prompt) {
                return;
            }
            this.#pendingPrompts.shift();
            if (!this.#sessionBacked && prompt.transcriptAppended !== true) {
                this.#appendEntry({ role: "user", text: prompt.displayText });
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
                turnCompleted = result.stopReason === "stop";
                if (!turnCompleted) {
                    this.#deferredTurnSeparator = false;
                    this.#workSegmentStartedAtMs = undefined;
                }
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
                this.#deferredTurnSeparator = false;
                this.#workSegmentStartedAtMs = undefined;
                this.#statusText = "Error";
                this.#appendEntry({ role: "error", text: errorToMessage(error) });
            }
        } finally {
            if (this.#isCurrentRun(runToken)) {
                if (this.#abortController === controller) {
                    this.#abortController = undefined;
                }
                this.#setRunning(false);
                this.#discardPendingToolCallEntries();
                this.#stopActivityAnimation();
                this.#streamEntryId = undefined;
                this.#thinkingEntryIdsByContentIndex.clear();
                this.#streamingThinkingEntryIds.clear();
                this.#toolCallEntryIdsByContentIndex.clear();
                this.#activeToolCallIds.clear();
                this.#awaitingApprovalToolCallIds.clear();
                this.#runningToolCallIds.clear();
                this.#toolStatusByCallId.clear();
                const turnElapsedMs =
                    !this.#sessionBacked && turnCompleted
                        ? this.#elapsedSinceLastUserInput(this.#now())
                        : undefined;
                if (turnElapsedMs !== undefined) this.#appendTurnCompletion(turnElapsedMs);
                this.#requestRender();
            }
        }
    }

    #handleEscape(): void {
        if (this.#running) {
            this.#lastEscapeAtMs = undefined;
            if (this.#interruptRequestInFlight) return;
            if (
                this.#sessionBacked &&
                this.#agent.abort !== undefined &&
                this.#activeSessionRunId !== undefined &&
                this.#hasLocalOrPendingSteering(this.#activeSessionRunId)
            ) {
                this.#requestSteeringInterrupt(this.#activeSessionRunId);
                return;
            }

            this.#restoreQueuedPromptsToComposer();
            if (this.#abortActiveRun()) return;
            if (this.#sessionBacked && this.#agent.abort !== undefined) {
                this.#requestSessionInterrupt(false);
            }
            return;
        }

        const doubleEscape = this.#registerEscapePress();
        if (doubleEscape) this.#clearComposerDraftToHistory();
        if (!doubleEscape && this.#editor.getText().trim().length > 0) {
            return;
        }

        this.#restoreQueuedPromptsToComposer();
    }

    #registerEscapePress(): boolean {
        const now = this.#now();
        const doubleEscape =
            this.#lastEscapeAtMs !== undefined &&
            now - this.#lastEscapeAtMs <= DOUBLE_ESCAPE_WINDOW_MS;
        this.#lastEscapeAtMs = doubleEscape ? undefined : now;
        return doubleEscape;
    }

    #clearComposerDraftToHistory(): void {
        const draft = this.#editor.getText().trim();
        if (draft.length === 0) return;
        this.#editor.addToHistory(draft);
        this.#editor.setText("");
        this.#fileMentionAutocomplete?.clear();
        this.#dismissedSlashCommandText = undefined;
    }

    #hasLocalOrPendingSteering(runId: string): boolean {
        return (
            this.#steeringInterruptIntent?.runId === runId ||
            [...this.#inFlightSteeringSubmissions.values()].some(
                (submission) => submission.runId === runId,
            ) ||
            this.#steeringMessageIdsForRun(runId).length > 0
        );
    }

    #requestSteeringInterrupt(runId: string): void {
        if (this.#steeringInterruptIntent?.runId !== runId) {
            this.#steeringInterruptIntent = { runId };
        }
        this.#interruptSettlementRunId = runId;
        this.#statusText = "Sending pending messages";
        this.#requestRender();
        this.#tryRequestSteeringInterrupt(runId);
    }

    #tryRequestSteeringInterrupt(runId: string): void {
        const intent = this.#steeringInterruptIntent;
        if (intent?.runId !== runId) return;
        if (
            [...this.#inFlightSteeringSubmissions.values()].some(
                (submission) => submission.runId === runId,
            )
        ) {
            return;
        }
        if (!this.#running || this.#activeSessionRunId !== runId) {
            this.#clearSteeringInterrupt(runId);
            return;
        }
        const steeringMessageIds = this.#steeringMessageIdsForRun(runId);
        if (steeringMessageIds.length === 0) {
            this.#clearSteeringInterrupt(runId);
            return;
        }

        this.#steeringInterruptIntent = undefined;
        this.#requestSessionInterrupt(true, steeringMessageIds);
    }

    #steeringMessageIdsForRun(runId: string): string[] {
        const messageIds = [
            ...this.#acceptedSteeringSubmissions
                .filter((submission) => submission.runId === runId && submission.accepted)
                .sort((left, right) => left.id - right.id)
                .map((submission) => submission.messageId),
            ...this.#pendingSteeringMessages
                .filter((pending) => pending.runId === runId)
                .sort((left, right) => left.transcriptIndex - right.transcriptIndex)
                .map((pending) => pending.id),
        ];
        return [...new Set(messageIds)].filter(
            (messageId) => !this.#continuationRequestedSteeringMessageIds.has(messageId),
        );
    }

    #clearSteeringInterrupt(runId: string): void {
        if (this.#steeringInterruptIntent?.runId === runId) {
            this.#steeringInterruptIntent = undefined;
        }
        if (!this.#interruptRequestInFlight && this.#interruptSettlementRunId === runId) {
            this.#interruptSettlementRunId = undefined;
        }
        if (this.#running && this.#activeSessionRunId === runId) {
            this.#statusText = "Running";
        }
        this.#startDrainQueue();
        this.#requestRender();
    }

    #requestSessionInterrupt(
        continuePendingSteering: boolean,
        steeringMessageIds: readonly string[] = [],
    ): void {
        if (this.#agent.abort === undefined || this.#interruptRequestInFlight) return;
        this.#interruptRequestInFlight = true;
        this.#interruptSettlementRunId = this.#activeSessionRunId;
        this.#statusText = continuePendingSteering ? "Sending pending messages" : "Stopping";
        this.#requestRender();
        if (continuePendingSteering) {
            for (const messageId of steeringMessageIds) {
                this.#continuationRequestedSteeringMessageIds.add(messageId);
            }
        }
        const request = continuePendingSteering
            ? this.#agent.abort({
                  continuePendingSteering: true,
                  ...(this.#activeSessionRunId === undefined
                      ? {}
                      : { expectedRunId: this.#activeSessionRunId }),
                  steeringMessageIds,
              })
            : this.#agent.abort(
                  this.#activeSessionRunId === undefined
                      ? undefined
                      : { expectedRunId: this.#activeSessionRunId },
              );
        void request
            .then((response) => {
                if (continuePendingSteering && response.continued !== true) {
                    for (const messageId of steeringMessageIds) {
                        this.#continuationRequestedSteeringMessageIds.delete(messageId);
                    }
                }
                if (this.#running) this.#statusText = "Running";
            })
            .catch((error: unknown) => {
                for (const messageId of steeringMessageIds) {
                    this.#continuationRequestedSteeringMessageIds.delete(messageId);
                }
                this.#interruptSettlementRunId = undefined;
                this.#statusText = "Error";
                this.#appendEntry({ role: "error", text: errorToMessage(error) });
            })
            .finally(() => {
                this.#interruptRequestInFlight = false;
                if (!this.#running) this.#interruptSettlementRunId = undefined;
                this.#startDrainQueue();
                this.#requestRender();
            });
    }

    #openBacktrackMenu(): boolean {
        if (this.#running || !this.#sessionBacked || this.#agent.rewind === undefined) {
            return false;
        }
        const userEntries = this.#entries.filter((entry) => entry.role === "user");
        if (userEntries.length === 0) return false;

        const items = [...userEntries].reverse().map((entry) => ({
            description: entry.text.replaceAll("\n", " ").trim() || "Message with attachments",
            label: entry.text.split("\n")[0]?.trim() || "Message with attachments",
            value: entry.id,
        }));
        this.#showSelectionPanel(
            createSelectionPanel({
                theme: this.#theme,
                items,
                onCancel: () => this.#closeSelectionPanel(),
                onSelect: (item) => {
                    if (this.#agent.rewind === undefined) return;
                    this.#closeSelectionPanel();
                    this.#discardLocalPromptsForBoundary();
                    this.#sessionMutationInFlight = true;
                    this.#sessionMutationBoundaryApplied = false;
                    this.#lastEscapeAtMs = undefined;
                    this.#statusText = "Rewinding";
                    this.#requestRender();
                    const mutation = this.#agent
                        .rewind(item.value)
                        .then((message) => this.#finishBacktrack(item.value, message))
                        .catch((error: unknown) => {
                            this.#statusText = "Error";
                            this.#appendEntry({ role: "error", text: errorToMessage(error) });
                        })
                        .finally(() => {
                            this.#sessionMutationInFlight = false;
                            if (this.#activeSessionMutation === mutation) {
                                this.#activeSessionMutation = undefined;
                            }
                            this.#requestRender();
                        });
                    this.#activeSessionMutation = mutation;
                },
                subtitle: "Choose a prompt to edit again. Files stay unchanged.",
                title: "Rewind conversation",
            }),
        );
        return true;
    }

    #finishBacktrack(messageId: string, message: UserMessage): void {
        const targetIndex = this.#entries.findIndex((entry) => entry.id === messageId);
        if (targetIndex >= 0) this.#entries = this.#entries.slice(0, targetIndex);
        this.#editor.setText(
            message.blocks
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("\n"),
        );
        this.#syncAutocompleteState();
        this.#modelLocked = false;
        this.#statusText = "Idle";
        this.#requestRender();
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

    #trackLocalSteeringSubmission(
        submission: PromptSubmission,
    ): LocalSteeringSubmission | undefined {
        if (!this.#sessionBacked || this.#activeSessionRunId === undefined) return undefined;
        const local: LocalSteeringSubmission = {
            accepted: false,
            applied: false,
            id: this.#nextSteeringSubmissionId++,
            invalidated: false,
            messageId: this.#idFactory(),
            runEnded: false,
            runId: this.#activeSessionRunId,
            submission,
        };
        this.#inFlightSteeringSubmissions.set(local.id, local);
        return local;
    }

    #settleLocalSteeringSubmission(
        local: LocalSteeringSubmission | undefined,
        accepted: boolean,
        response?: void | SteerMessageResponse,
    ): void {
        if (local === undefined) return;
        this.#inFlightSteeringSubmissions.delete(local.id);
        if (local.invalidated) return;

        if (response !== undefined) local.runId = response.runId;
        local.accepted ||= accepted;

        if (local.accepted) {
            if (local.runEnded && !local.applied) {
                this.#rejectedSteeringSubmissions.set(local.id, local);
                this.#removePendingSteeringMessage(local.messageId);
            } else if (
                !local.runEnded &&
                !this.#acceptedSteeringSubmissions.some((submission) => submission.id === local.id)
            ) {
                this.#acceptedSteeringSubmissions.push(local);
            }
        } else {
            this.#rejectedSteeringSubmissions.set(local.id, local);
        }

        const runHasInFlight = [...this.#inFlightSteeringSubmissions.values()].some(
            (submission) => submission.runId === local.runId,
        );
        if (!runHasInFlight) this.#restoreRejectedSteeringSubmissions(local.runId);
        this.#tryRequestSteeringInterrupt(local.runId);
        this.#requestRender();
    }

    #localSteeringSubmission(messageId: string): LocalSteeringSubmission | undefined {
        return (
            [...this.#inFlightSteeringSubmissions.values()].find(
                (submission) => submission.messageId === messageId,
            ) ??
            this.#acceptedSteeringSubmissions.find(
                (submission) => submission.messageId === messageId,
            ) ??
            [...this.#rejectedSteeringSubmissions.values()].find(
                (submission) => submission.messageId === messageId,
            )
        );
    }

    #removePendingSteeringMessage(messageId: string): void {
        this.#pendingSteeringMessages = this.#pendingSteeringMessages.filter(
            (submission) => submission.id !== messageId,
        );
    }

    #restoreRejectedSteeringSubmissions(runId: string): void {
        const rejected = [...this.#rejectedSteeringSubmissions.values()]
            .filter((submission) => submission.runId === runId && !submission.invalidated)
            .sort((left, right) => left.id - right.id);
        if (rejected.length === 0) return;
        for (const submission of rejected) {
            this.#rejectedSteeringSubmissions.delete(submission.id);
        }

        const restored = rejected.map((submission) => submission.submission.displayText);
        const draft = this.#editor.getText().trim();
        if (draft.length > 0) restored.push(draft);
        this.#editor.setText(restored.join("\n"));
        this.#syncAutocompleteState();
    }

    #finishLocalSteeringRun(runId: string): void {
        for (const submission of [
            ...this.#inFlightSteeringSubmissions.values(),
            ...this.#acceptedSteeringSubmissions,
        ]) {
            if (submission.runId === runId) {
                this.#continuationRequestedSteeringMessageIds.delete(submission.messageId);
            }
        }
        for (const pending of this.#pendingSteeringMessages) {
            if (pending.runId === runId) {
                this.#continuationRequestedSteeringMessageIds.delete(pending.id);
            }
        }
        for (const submission of this.#inFlightSteeringSubmissions.values()) {
            if (submission.runId === runId) submission.runEnded = true;
        }
        for (const submission of this.#acceptedSteeringSubmissions) {
            if (submission.runId === runId && !submission.applied) {
                this.#rejectedSteeringSubmissions.set(submission.id, submission);
                this.#removePendingSteeringMessage(submission.messageId);
            }
        }
        this.#acceptedSteeringSubmissions = this.#acceptedSteeringSubmissions.filter(
            (submission) => submission.runId !== runId,
        );
        if (
            ![...this.#inFlightSteeringSubmissions.values()].some(
                (submission) => submission.runId === runId,
            )
        ) {
            this.#restoreRejectedSteeringSubmissions(runId);
        }
        this.#clearSteeringInterrupt(runId);
    }

    #discardLocalSteeringSubmissionsForBoundary(): void {
        for (const submission of this.#inFlightSteeringSubmissions.values()) {
            submission.invalidated = true;
        }
        this.#inFlightSteeringSubmissions.clear();
        this.#acceptedSteeringSubmissions = [];
        this.#rejectedSteeringSubmissions.clear();
        this.#continuationRequestedSteeringMessageIds.clear();
        this.#steeringInterruptIntent = undefined;
        if (!this.#interruptRequestInFlight) this.#interruptSettlementRunId = undefined;
    }

    #discardLocalPromptsForBoundary(): number {
        this.#discardLocalSteeringSubmissionsForBoundary();
        const discarded = this.#pendingPrompts;
        for (const prompt of discarded) this.#editor.addToHistory(prompt.displayText);
        this.#pendingPrompts = [];
        this.#runToken += 1;
        this.#abortController?.abort();
        this.#abortController = undefined;
        return discarded.length;
    }

    #sessionEventRunId(event: SessionEvent): string | undefined {
        const runId = (event.data as { runId?: unknown }).runId;
        return typeof runId === "string" ? runId : undefined;
    }

    #abortActiveRun(options: { silent?: boolean } = {}): boolean {
        if (!this.#running || this.#abortController === undefined) {
            return false;
        }

        const controller = this.#abortController;
        this.#runToken += 1;
        controller.abort();
        this.#abortController = undefined;
        this.#setRunning(false);
        this.#statusText = "Idle";
        this.#discardPendingToolCallEntries();
        this.#thinkingEntryIdsByContentIndex.clear();
        this.#streamingThinkingEntryIds.clear();
        this.#toolCallEntryIdsByContentIndex.clear();
        this.#markActiveToolCallsStopped();
        this.#activeToolCallIds.clear();
        this.#awaitingApprovalToolCallIds.clear();
        this.#runningToolCallIds.clear();
        this.#toolStatusByCallId.clear();
        this.#stopActivityAnimation();
        void this.#processManager.killAll({ forceAfterMs: 500 }).catch((error: unknown) => {
            this.#appendEntry({ role: "error", text: errorToMessage(error) });
        });
        if (options.silent !== true) {
            this.#appendAbortNotice();
        }
        this.#requestRender();
        return true;
    }

    async #abortIdleSession(): Promise<void> {
        try {
            const localProcessCount = this.#processManager.activeCount();
            let response;
            if (this.#agent.abort === undefined) {
                await this.#processManager.killAll({ forceAfterMs: 500 });
                response = { aborted: false, stoppedProcesses: localProcessCount };
            } else {
                response = await this.#agent.abort();
            }
            const stoppedProcesses = response.stoppedProcesses ?? 0;
            this.#appendEntry({
                role: "event",
                title: "abort",
                text:
                    stoppedProcesses === 0
                        ? "No active run."
                        : `Stopped ${String(stoppedProcesses)} background ${stoppedProcesses === 1 ? "process" : "processes"}.`,
            });
        } catch (error) {
            this.#appendEntry({ role: "error", text: errorToMessage(error) });
        }
        this.#requestRender();
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
            this.#streamedToolCallEntries.clear();
            this.#thinkingEntryIdsByContentIndex.clear();
            this.#streamingThinkingEntryIds.clear();
            this.#toolCallEntryIdsByContentIndex.clear();
        } else if (event.type === "inference_retry") {
            this.#statusText = `Retrying incomplete response · ${event.attempt} of ${event.maxAttempts}`;
        } else if (event.type === "text_start") {
            this.#statusText = "Running";
        } else if (event.type === "text_delta") {
            this.#appendStreamText(event.delta);
        } else if (event.type === "text_end") {
            this.#finishStreamText(event.content);
        } else if (event.type === "thinking_start") {
            this.#statusText = "Thinking";
            const entry = this.#ensureThinkingEntry(event.contentIndex);
            this.#streamingThinkingEntryIds.add(entry.id);
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
            this.#activeToolCallIds.add(event.toolCall.id);
            this.#runningToolCallIds.add(event.toolCall.id);
            this.#refreshToolActivityStatus();
        } else if (event.type === "tool_execution_end") {
            const entry = this.#entries.find(
                (candidate) => candidate.id === event.result.toolCallId,
            );
            if (entry?.mcpToolCall === undefined) {
                this.#finishToolResult(event.result);
                this.#markConcreteWorkCompleted(event.result);
            } else {
                this.#runningToolCallIds.delete(event.result.toolCallId);
                this.#toolStatusByCallId.delete(event.result.toolCallId);
            }
            this.#refreshToolActivityStatus();
        } else if (event.type === "tool_execution_progress") {
            const entry = this.#entries.find((candidate) => candidate.id === event.toolCallId);
            if (entry !== undefined) entry.detail = this.#singleLine(event.display);
        } else if (event.type === "tool_execution_status") {
            if (this.#runningToolCallIds.has(event.toolCallId)) {
                this.#toolStatusByCallId.set(event.toolCallId, this.#singleLine(event.status));
                this.#refreshToolActivityStatus();
            }
        } else if (event.type === "context_compacted") {
            this.#latestContextTokens = event.estimatedTokensAfter;
            this.#appendEntry({
                role: "event",
                title: "Context compacted",
                text: `Summarized ${event.compactedMessageCount} older messages; ${formatTokens(event.estimatedTokensBefore)} → ${formatTokens(event.estimatedTokensAfter)} tokens.`,
            });
        } else if (event.type === "tool_batch_rejected") {
            const rejectedIds = new Set(event.toolCallIds);
            this.#entries = this.#entries.filter(
                (entry) => !this.#streamedToolCallEntries.has(entry),
            );
            this.#streamedToolCallEntries.clear();
            for (const toolCallId of rejectedIds) {
                this.#activeToolCallIds.delete(toolCallId);
                this.#awaitingApprovalToolCallIds.delete(toolCallId);
                this.#runningToolCallIds.delete(toolCallId);
                this.#toolStatusByCallId.delete(toolCallId);
                if (!this.#entries.some((entry) => entry.id === toolCallId)) {
                    this.#seenToolCallIds.delete(toolCallId);
                    this.#stoppedToolCallIds.delete(toolCallId);
                }
            }
            this.#statusText = "Working";
        } else if (event.type === "permission_review") {
            if (event.decision === "ask") {
                this.#awaitingApprovalToolCallIds.add(event.toolCallId);
                this.#statusText = "Waiting for approval";
                const toolEntry = this.#entries.find((entry) => entry.id === event.toolCallId);
                if (toolEntry !== undefined) {
                    toolEntry.permissionReview = `Needs approval: ${event.reason} Risk: ${event.risk}. User authorization: ${event.userAuthorization}.`;
                }
            }
        } else if (event.type === "background_processes_changed") {
            const nextProcesses =
                event.processes ?? (event.running === 0 ? [] : this.#observedShellProcesses);
            this.#recordClosedBackgroundTerminals(nextProcesses);
            this.#observedShellProcesses = nextProcesses;
            this.#backgroundProcesses = nextProcesses.filter((process) =>
                this.#yieldedBackgroundTerminals.has(process.sessionId),
            );
        } else if (event.type === "background_processes_stopped") {
            this.#backgroundProcesses = [];
            this.#yieldedBackgroundTerminals.clear();
            this.#appendEntry({
                role: "event",
                title: "permissions",
                text: `Stopped ${event.count} running process${event.count === 1 ? "" : "es"} before reducing permissions.`,
            });
        } else if (event.type === "done") {
            this.#statusText = event.reason === "toolUse" ? "Running tools" : "Working";
        } else if (event.type === "error") {
            if (event.reason === "aborted") {
                this.#statusText = "Idle";
                this.#appendAbortNotice();
                return;
            }
            this.#deferredTurnSeparator = false;
            this.#workSegmentStartedAtMs = undefined;
            this.#statusText = "Error";
            this.#appendEntry({
                role: "error",
                text: event.error.errorMessage ?? "Provider returned an error.",
            });
        }

        this.#requestRender();
    }

    #markActiveToolCallsStopped(): void {
        for (const toolCallId of this.#activeToolCallIds) {
            this.#stoppedToolCallIds.add(toolCallId);
        }
        for (const toolCallId of this.#awaitingApprovalToolCallIds) {
            this.#stoppedToolCallIds.add(toolCallId);
        }
    }

    #appendAbortNotice(): void {
        this.#deferredTurnSeparator = false;
        this.#workSegmentStartedAtMs = undefined;
        this.#markActiveToolCallsStopped();
        this.#activeToolCallIds.clear();
        this.#awaitingApprovalToolCallIds.clear();
        this.#runningToolCallIds.clear();
        this.#toolStatusByCallId.clear();
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
                const mcpToolCall = this.#createMcpToolCall(block.name, block.arguments);
                this.#appendEntry({
                    id: block.id,
                    role: "tool",
                    title: this.#toolDisplayName(block.name),
                    text: this.#formatToolCall(block.name, block.arguments),
                    ...(mcpToolCall === undefined ? {} : { mcpToolCall }),
                });
            } else if (block.type === "tool_result") {
                this.#finishToolResult(block);
                this.#markConcreteWorkCompleted(block);
            }
        }

        flushText();
        this.#refreshToolActivityStatus();
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
        this.#streamingThinkingEntryIds.add(entry.id);
        entry.text += delta;
    }

    #finishThinkingText(contentIndex: number, text: string): void {
        if (text.length === 0 && !this.#thinkingEntryIdsByContentIndex.has(contentIndex)) {
            return;
        }

        const entry = this.#ensureThinkingEntry(contentIndex);
        entry.text = text;
        this.#streamingThinkingEntryIds.delete(entry.id);
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
        this.#streamedToolCallEntries.add(entry);
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
        this.#stoppedToolCallIds.delete(toolCall.id);
        this.#activeToolCallIds.add(toolCall.id);
        this.#statusText = `Calling ${this.#toolDisplayName(toolCall.name)}`;
        const mcpToolCall = this.#createMcpToolCall(toolCall.name, toolCall.arguments);

        const existingId = this.#toolCallEntryIdsByContentIndex.get(contentIndex);
        const existing =
            existingId === undefined
                ? undefined
                : this.#entries.find((entry) => entry.id === existingId);

        const backgroundInteraction = this.#backgroundTerminalInteraction(
            toolCall.name,
            toolCall.arguments,
        );
        if (backgroundInteraction !== undefined) {
            this.#toolStatusByCallId.set(toolCall.id, backgroundInteraction.label);
        }
        if (existing !== undefined && backgroundInteraction?.input === "") {
            this.#removeUnrenderedToolEntry(existing);
            this.#toolCallEntryIdsByContentIndex.delete(contentIndex);
            return;
        }

        if (existing !== undefined) {
            existing.id = toolCall.id;
            existing.title = this.#toolDisplayName(toolCall.name);
            existing.text = this.#formatToolCall(toolCall.name, toolCall.arguments);
            if (mcpToolCall === undefined) {
                delete existing.mcpToolCall;
            } else {
                existing.mcpToolCall = mcpToolCall;
            }
            this.#toolCallEntryIdsByContentIndex.delete(contentIndex);
            return;
        }

        this.#toolCallEntryIdsByContentIndex.delete(contentIndex);
        this.#appendEntry({
            id: toolCall.id,
            role: "tool",
            title: this.#toolDisplayName(toolCall.name),
            text: this.#formatToolCall(toolCall.name, toolCall.arguments),
            ...(mcpToolCall === undefined ? {} : { mcpToolCall }),
        });
    }

    #backgroundTerminalInteraction(
        toolName: string,
        args: unknown,
    ): { input: string; label: string } | undefined {
        if (toolName.toLowerCase() !== "write_stdin" || !this.#isRecord(args)) return undefined;
        const input = typeof args.chars === "string" ? args.chars : "";
        return {
            input,
            label:
                input.length === 0
                    ? "Waiting for background terminal"
                    : "Interacting with background terminal",
        };
    }

    #removeUnrenderedToolEntry(entry: AppTranscriptEntry): void {
        const index = this.#entries.indexOf(entry);
        if (index < 0) return;
        this.#entries.splice(index, 1);
        this.#streamedToolCallEntries.delete(entry);
        this.#removeOrphanedSeparators();
    }

    #removeOrphanedSeparators(): void {
        const retained: AppTranscriptEntry[] = [];
        for (const entry of this.#entries) {
            if (entry.role === "separator" && retained.at(-1)?.role === "separator") {
                if (entry.turnElapsedMs !== undefined) {
                    retained[retained.length - 1]!.turnElapsedMs = entry.turnElapsedMs;
                }
                continue;
            }
            retained.push(entry);
        }
        const trailing = retained.at(-1);
        if (trailing?.role === "separator" && trailing.turnElapsedMs === undefined) {
            retained.pop();
        }
        this.#entries = retained;
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
                if (!this.#abortNotified) entry.text = text;
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
        if (entry.backgroundTerminalCompletion !== undefined) {
            completeEntry.backgroundTerminalCompletion = entry.backgroundTerminalCompletion;
        }
        if (entry.backgroundTerminalInteraction !== undefined) {
            completeEntry.backgroundTerminalInteraction = entry.backgroundTerminalInteraction;
        }
        if (entry.childText !== undefined) {
            completeEntry.childText = entry.childText;
        }
        if (entry.execCommand !== undefined) {
            completeEntry.execCommand = entry.execCommand;
        }
        if (entry.fileDiffs !== undefined) {
            completeEntry.fileDiffs = entry.fileDiffs;
        }
        if (entry.omittedFileDiffs !== undefined) {
            completeEntry.omittedFileDiffs = entry.omittedFileDiffs;
        }
        if (entry.mcpToolCall !== undefined) {
            completeEntry.mcpToolCall = entry.mcpToolCall;
        }
        if (entry.noticeChildren !== undefined) {
            completeEntry.noticeChildren = entry.noticeChildren;
        }
        if (entry.permissionReview !== undefined) {
            completeEntry.permissionReview = entry.permissionReview;
        }
        if (entry.title !== undefined) {
            completeEntry.title = entry.title;
        }
        if (entry.turnElapsedMs !== undefined) {
            completeEntry.turnElapsedMs = entry.turnElapsedMs;
        }

        this.#entries.push(completeEntry);
        this.#requestRender();
        return completeEntry;
    }

    #clearEntries(): void {
        this.#entries = [];
        this.#streamedToolCallEntries.clear();
        this.#stoppedToolCallIds.clear();
        this.#observedShellProcesses = [];
        this.#yieldedBackgroundTerminals.clear();
        this.#deferredTurnSeparator = false;
        this.#workSegmentStartedAtMs = undefined;
    }

    #discardPendingToolCallEntries(): void {
        this.#entries = this.#entries.filter((entry) => {
            const pending =
                this.#streamedToolCallEntries.has(entry) &&
                entry.title === PENDING_TOOL_CALL_TITLE &&
                entry.text === PENDING_TOOL_CALL_TITLE;
            return !pending;
        });
        this.#streamedToolCallEntries.clear();
        this.#removeOrphanedSeparators();
    }

    #renderHeader(width: number): string[] {
        const cached = this.#headerLinesByWidth.get(width);
        if (cached !== undefined) return [...cached];
        const lines = [
            "",
            ...renderRigBanner({
                brand: this.#theme.brand,
                secondary: this.#theme.secondary,
                version: this.#version,
                width,
            }),
            "",
            ...renderStartupStatusCard({
                model: this.#startupStatus,
                theme: this.#theme,
                width,
            }),
            "",
        ];
        this.#headerLinesByWidth.set(width, lines);
        return lines;
    }

    #renderTranscript(width: number): string[] {
        const entries = this.#terminalResizeTranscriptEntries ?? this.#visibleTranscriptEntries();
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

    #visibleTranscriptEntries(): AppTranscriptEntry[] {
        const sourceEntries = this.#entries.filter(
            (entry) => !this.#activeToolCallIds.has(entry.id),
        );
        return this.#showReasoning
            ? [...sourceEntries]
            : sourceEntries.filter((entry) => entry.role !== "thinking");
    }

    #renderTranscriptEntries(entries: readonly AppTranscriptEntry[], width: number): string[] {
        const lines: string[] = [];
        for (const entry of entries) {
            const entryLines = this.#entryRenderCache.render(
                entry,
                {
                    dynamicState: this.#entryRenderState(entry),
                    theme: this.#theme,
                    width,
                },
                () => this.#renderEntry(entry, width),
            );
            if (entryLines.length === 0) continue;
            if (lines.length > 0) lines.push("");
            lines.push(...entryLines);
        }
        return lines;
    }

    #entryRenderState(entry: AppTranscriptEntry): string {
        if (entry.role !== "tool" && entry.role !== "error") return "";
        return [
            this.#activeToolCallIds.has(entry.id),
            this.#awaitingApprovalToolCallIds.has(entry.id),
            this.#stoppedToolCallIds.has(entry.id),
            this.#shouldRenderActivityAsLastMessage(),
        ].join(":");
    }

    #renderEntry(entry: AppTranscriptEntry, width: number): string[] {
        if (entry.role === "separator") {
            return [
                entry.turnElapsedMs === undefined
                    ? this.#turnSeparator(width)
                    : renderTurnCompletionSeparator(entry.turnElapsedMs, width),
            ];
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
        if (entry.backgroundTerminalCompletion !== undefined) {
            return [renderBackgroundTerminalCompletion(entry.backgroundTerminalCompletion, width)];
        }
        if (entry.backgroundTerminalInteraction !== undefined) {
            return renderBackgroundTerminalInteraction(entry.backgroundTerminalInteraction, width);
        }
        if (entry.execCommand !== undefined) {
            const stopped = this.#stoppedToolCallIds.has(entry.id);
            const isError = entry.role === "error";
            return renderExecCommand(entry.execCommand, {
                brand: this.#theme.brand,
                primary: this.#theme.primary,
                ...(entry.permissionReview === undefined ? {} : { review: entry.permissionReview }),
                status: stopped || isError ? this.#theme.error : this.#theme.success,
                verb: stopped ? "Stopped" : isError ? "Failed" : "Ran",
                width,
            });
        }
        if (entry.mcpToolCall !== undefined) {
            return this.#renderMcpToolEntry(entry, width);
        }
        if (entry.fileDiffs !== undefined && entry.fileDiffs.length > 0 && entry.role !== "error") {
            return this.#renderFileDiffEntry(entry, width);
        }
        if (entry.role === "tool") {
            return this.#renderToolEntry(entry, width, false);
        }
        if (entry.role === "error") {
            return entry.detail === undefined
                ? this.#renderNoticeEntry(
                      entry.title ?? "Error",
                      entry.text,
                      width,
                      this.#theme.error,
                  )
                : this.#renderToolEntry(entry, width, true);
        }
        if (entry.role === "event") {
            if (entry.noticeChildren !== undefined) {
                return renderNoticeWithChildren({
                    children: entry.noticeChildren,
                    color: this.#theme.warning,
                    title: entry.title ?? "event",
                    width,
                });
            }
            return this.#renderNoticeEntry(
                entry.title ?? "event",
                entry.text,
                width,
                this.#theme.warning,
                entry.childText === true,
            );
        }

        return this.#renderNoticeEntry("system", entry.text, width, this.#theme.secondary);
    }

    #renderFooter(
        width: number,
        suggestions: readonly AutocompleteItem[],
        selectedIndex: number,
    ): string[] {
        if (suggestions.length > 0) {
            return this.#renderAutocomplete(width, suggestions, selectedIndex);
        }

        const parts = [`${this.#theme.warning}${this.#modelWithReasoningDisplayName()}${RESET}`];
        parts.push(`${this.#theme.success}${this.#cwdDisplayName()}${RESET}`);
        if (this.#activeAgentLabel !== undefined) {
            parts.push(`${this.#theme.secondary}${this.#activeAgentLabel}${RESET}`);
        }
        if (this.#pendingPrompts.length > 0) {
            parts.push(`${this.#theme.secondary}queued ${this.#pendingPrompts.length}${RESET}`);
        }
        parts.push(
            `${this.#theme.secondary}${humanizePermissionMode(this.#agent.permissionMode).toLowerCase()}${RESET}`,
        );
        if (this.#showUsage) parts.push(`${this.#theme.secondary}${this.#usageFooter()}${RESET}`);

        const indent = " ".repeat(visibleWidth(INPUT_PROMPT));
        const separator = `${DIM} · ${RESET}`;
        const line = `${indent}${parts.join(separator)}`;
        if (visibleWidth(line) <= width || this.#activeAgentLabel === undefined) {
            return [this.#fitLine(line, width)];
        }

        const access = parts.at(this.#showUsage ? -2 : -1);
        if (access === undefined) return [this.#fitLine(line, width)];
        const prefixParts = parts.filter((part) => part !== access);
        const suffix = `${separator}${access}`;
        const prefixWidth = Math.max(0, width - visibleWidth(suffix));
        if (prefixWidth === 0) return [this.#fitLine(`${indent}${access}`, width)];
        return [
            `${truncateToWidth(`${indent}${prefixParts.join(separator)}`, prefixWidth)}${suffix}`,
        ];
    }

    #activeSubagentCount(): number {
        return this.#subagents.filter((subagent) => this.#isActiveSubagent(subagent)).length;
    }

    #isActiveSubagent(subagent: SubagentSummary): boolean {
        return (
            (subagent.status === "queued" || subagent.status === "running") &&
            !subagent.taskName?.startsWith("workflow_")
        );
    }

    #hasActiveSubagentDescendant(parentId: string): boolean {
        const byId = new Map(this.#subagents.map((subagent) => [subagent.id, subagent]));
        return this.#subagents.some((subagent) => {
            if (!this.#isActiveSubagent(subagent)) return false;
            let parent = byId.get(subagent.parentSessionId);
            while (parent !== undefined) {
                if (parent.id === parentId) return true;
                parent = byId.get(parent.parentSessionId);
            }
            return false;
        });
    }

    #activeWorkflowCount(): number {
        return this.#workflows.filter((workflow) => workflow.status === "running").length;
    }

    #renderActiveWorkList(width: number): string[] {
        const activeSubagents = this.#subagents.filter((subagent) =>
            this.#isActiveSubagent(subagent),
        );
        const rows = [
            ...this.#renderActiveToolRows(width),
            renderSubagentSummary({
                count: activeSubagents.length,
                elapsedMs: Math.max(
                    0,
                    ...activeSubagents.map((subagent) => subagentElapsedMs(subagent, this.#now())),
                ),
                totalTokens: this.#subagents
                    .filter((subagent) => !subagent.taskName?.startsWith("workflow_"))
                    .reduce((total, subagent) => total + (subagent.totalTokens ?? 0), 0),
                width,
            }),
            renderWorkflowSummary(this.#activeWorkflowCount(), width),
            renderBackgroundTerminalSummary(this.#backgroundProcesses.length, width),
        ];
        return rows.filter((row): row is string => row !== undefined);
    }

    #renderActiveToolRows(width: number): string[] {
        return this.#entries
            .filter((entry) => this.#activeToolCallIds.has(entry.id))
            .flatMap((entry) => this.#renderEntry(entry, width));
    }

    #usageFooter(): string {
        const window = this.#agent.model.contextWindow;
        if (window === undefined) return `${formatTokens(this.#latestContextTokens)} tokens`;
        const percentLeft = Math.max(0, Math.round((1 - this.#latestContextTokens / window) * 100));
        return `${formatTokens(this.#latestContextTokens)} tokens · ${percentLeft}% left`;
    }

    #subagentMetrics(subagent: SubagentSummary): string {
        return `${formatActivityElapsedTime(subagentElapsedMs(subagent, this.#now()))} · ${formatTokens(subagent.totalTokens ?? 0)} tokens`;
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

    #promotePendingSteeringMessages(messageIds: readonly string[]): void {
        for (const messageId of messageIds) {
            const index = this.#pendingSteeringMessages.findIndex(
                (pending) => pending.id === messageId,
            );
            if (index < 0) continue;
            const [pending] = this.#pendingSteeringMessages.splice(index, 1);
            if (pending !== undefined) {
                this.#entries.push({
                    id: pending.id,
                    role: "user",
                    text: pending.displayText,
                });
            }
        }
        this.#requestRender();
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
                ? `${this.#theme.brand}${marker}${label}${description}${RESET}`
                : `${marker}${label}${DIM}${this.#theme.secondary}${description}${RESET}`;
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
            theme: this.#theme,
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
            theme: this.#theme,
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
                    if (!this.#modelLocked) {
                        this.#persistDefaultModel(
                            model.id,
                            item.value,
                            providerId,
                            this.#agent.confirmedServiceTier ?? null,
                        );
                    }
                    if (!this.#sessionBacked) {
                        this.#appendEntry({
                            role: "event",
                            title: "reasoning",
                            text: `Reasoning changed to ${humanizeReasoningLevel(item.value)}.`,
                        });
                    }
                } else {
                    const completeChange = () => {
                        this.#persistDefaultModel(
                            model.id,
                            item.value,
                            providerId,
                            this.#agent.confirmedServiceTier ?? null,
                        );
                        if (!this.#sessionBacked) {
                            this.#appendEntry({
                                role: "event",
                                title: "model",
                                text: `Model changed to ${model.name} with ${humanizeReasoningLevel(item.value)} reasoning.`,
                            });
                        }
                        this.#requestRender();
                    };
                    try {
                        const change = this.#agent.setModel(model.id, item.value, providerId);
                        if (change === undefined) {
                            completeChange();
                        } else {
                            void change.then(completeChange).catch((error: unknown) => {
                                this.#appendEntry({
                                    role: "error",
                                    text: `Could not change to ${model.name}: ${errorToMessage(error)}`,
                                });
                                this.#requestRender();
                            });
                        }
                    } catch (error) {
                        this.#appendEntry({
                            role: "error",
                            text: `Could not change to ${model.name}: ${errorToMessage(error)}`,
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
            theme: this.#theme,
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
                {
                    value: "completion-chime",
                    label: this.#completionChime
                        ? "Disable completion chime"
                        : "Enable completion chime",
                    description: "Ring once when all session work has settled.",
                },
                {
                    value: "durable-events",
                    label: this.#durableGlobalEventQueue
                        ? "Disable durable event queue"
                        : "Enable durable event queue",
                    description: "Persist every daemon event for external synchronization.",
                },
            ],
            onSelect: (item) => {
                if (item.value === "reasoning") this.#showReasoning = !this.#showReasoning;
                if (item.value === "usage") this.#showUsage = !this.#showUsage;
                if (item.value === "completion-chime") {
                    this.#completionChime = !this.#completionChime;
                }
                if (item.value === "durable-events") {
                    this.#durableGlobalEventQueue = !this.#durableGlobalEventQueue;
                }
                this.#persistSettings();
                this.#closeSelectionPanel();
                let text: string;
                if (item.value === "reasoning") {
                    text = `Reasoning display ${this.#showReasoning ? "enabled" : "disabled"}.`;
                } else if (item.value === "usage") {
                    text = `Token status ${this.#showUsage ? "enabled" : "disabled"}.`;
                } else if (item.value === "completion-chime") {
                    text = `Completion chime ${this.#completionChime ? "enabled" : "disabled"}.`;
                } else {
                    text = `Durable event queue ${this.#durableGlobalEventQueue ? "enabled" : "disabled"}.`;
                }
                this.#appendEntry({
                    role: "event",
                    title: "settings",
                    text,
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
            theme: this.#theme,
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
                try {
                    const change = this.#agent.setPermissionMode(mode);
                    if (change !== undefined) {
                        void change.catch((error: unknown) => {
                            this.#appendEntry({ role: "error", text: errorToMessage(error) });
                            this.#requestRender();
                        });
                    }
                } catch (error) {
                    this.#appendEntry({ role: "error", text: errorToMessage(error) });
                }
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
        if (question.required === false) {
            items.push({
                value: "skip",
                label: "Leave unset",
                description: "Leave this optional answer unset.",
            });
        }
        items.push({
            value: "other",
            label: "Type another answer",
            description: "Enter a response that is not listed.",
        });

        this.#showSelectionPanel(
            createSelectionPanel({
                theme: this.#theme,
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
                    if (item.value === "skip") {
                        this.#commitUserInputAnswer([]);
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
        if (active === undefined || question === undefined) return;
        if (answers.length === 0 && question.required !== false) return;

        if (answers.length === 0) delete active.answers[question.id];
        else active.answers[question.id] = [...answers];
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
        this.#lastEscapeAtMs = undefined;
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
                    text: `The answer could not be sent: ${errorToMessage(error)}`,
                });
                this.#openNextUserInputRequest();
                this.#requestRender();
            });
    }

    #removeUserInputRequest(requestId: string): void {
        const wasActive = this.#activeUserInput?.request.requestId === requestId;
        const wasFreeform = this.#freeformUserInput?.requestId === requestId;
        if (requestId.endsWith(":permission")) {
            const toolCallId = requestId.slice(0, -":permission".length);
            if (this.#awaitingApprovalToolCallIds.delete(toolCallId)) {
                this.#refreshToolActivityStatus();
            }
        }
        this.#userInputRequests = this.#userInputRequests.filter(
            (request) => request.requestId !== requestId,
        );
        if (wasActive) this.#activeUserInput = undefined;
        if (wasFreeform) {
            this.#freeformUserInput = undefined;
            this.#lastEscapeAtMs = undefined;
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
        if (hadVisibleRequest) this.#lastEscapeAtMs = undefined;
        if (hadVisibleRequest) this.#closeSelectionPanel();
    }

    #showSelectionPanel(component: Component): void {
        this.#secretMenu.hide();
        this.#setSelectionPanel(component);
    }

    #closeSelectionPanel(): void {
        this.#secretMenu.hide();
        this.#setSelectionPanel(undefined);
    }

    #setSelectionPanel(component: Component | undefined): void {
        this.#lastEscapeAtMs = undefined;
        this.#selectionPanel = component;
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
        block: Pick<
            ToolResultBlock,
            "display" | "failure" | "isError" | "presentation" | "toolCallId" | "toolName"
        > &
            Partial<Pick<ToolResultBlock, "rendered">>,
    ): void {
        this.#moveActiveToolEntryToTranscriptTail(block.toolCallId);
        this.#activeToolCallIds.delete(block.toolCallId);
        this.#awaitingApprovalToolCallIds.delete(block.toolCallId);
        this.#runningToolCallIds.delete(block.toolCallId);
        this.#toolStatusByCallId.delete(block.toolCallId);
        if (block.isError === true && block.failure?.kind === "interrupted") {
            this.#stoppedToolCallIds.add(block.toolCallId);
        } else {
            this.#stoppedToolCallIds.delete(block.toolCallId);
        }
        const existing = this.#entries.find((entry) => entry.id === block.toolCallId);
        if (
            block.presentation?.type === "background_terminal_interaction" &&
            block.presentation.input === ""
        ) {
            if (existing !== undefined) this.#removeUnrenderedToolEntry(existing);
            return;
        }
        const detail = this.#formatToolResult(block);
        if (existing !== undefined) {
            existing.role = block.isError ? "error" : "tool";
            existing.title = this.#toolDisplayName(block.toolName);
            if (block.presentation?.type === "exec_command") {
                existing.execCommand = block.presentation;
                delete existing.backgroundTerminalInteraction;
                delete existing.detail;
                delete existing.fileDiffs;
                delete existing.omittedFileDiffs;
                this.#trackYieldedBackgroundTerminal(block.presentation);
                return;
            } else if (block.isError === true) {
                delete existing.backgroundTerminalInteraction;
                delete existing.execCommand;
                delete existing.fileDiffs;
                delete existing.omittedFileDiffs;
            } else if (block.presentation?.type === "background_terminal_interaction") {
                existing.backgroundTerminalInteraction = block.presentation;
                delete existing.detail;
                delete existing.fileDiffs;
                delete existing.omittedFileDiffs;
                return;
            } else if (
                block.presentation?.type === "file_diff" &&
                block.presentation.files.length > 0
            ) {
                existing.fileDiffs = block.presentation.files;
                if (block.presentation.omittedFiles === undefined) {
                    delete existing.omittedFileDiffs;
                } else {
                    existing.omittedFileDiffs = block.presentation.omittedFiles;
                }
            }
            if (existing.mcpToolCall !== undefined) {
                const result =
                    formatCodexMcpToolResult(block.rendered) ??
                    (block.isError === true ? undefined : "(empty result)");
                existing.mcpToolCall = {
                    invocation: existing.mcpToolCall.invocation,
                    ...(result === undefined
                        ? existing.mcpToolCall.result === undefined
                            ? {}
                            : { result: existing.mcpToolCall.result }
                        : { result }),
                    status: block.isError === true ? "error" : "success",
                };
            }
            if (block.failure?.kind === "tool_unavailable") {
                existing.text = this.#toolDisplayName(block.toolName);
            }
            existing.detail = detail;
            return;
        }

        const appended = this.#appendEntry({
            id: block.toolCallId,
            role: block.isError ? "error" : "tool",
            title: this.#toolDisplayName(block.toolName),
            text: this.#toolDisplayName(block.toolName),
            ...(block.presentation?.type === "background_terminal_interaction"
                ? { backgroundTerminalInteraction: block.presentation }
                : block.presentation?.type === "exec_command"
                  ? { execCommand: block.presentation }
                  : { detail }),
            ...(block.isError !== true &&
            block.presentation?.type === "file_diff" &&
            block.presentation.files.length > 0
                ? { fileDiffs: block.presentation.files }
                : {}),
            ...(block.isError !== true &&
            block.presentation?.type === "file_diff" &&
            block.presentation.omittedFiles !== undefined
                ? { omittedFileDiffs: block.presentation.omittedFiles }
                : {}),
        });
        if (appended.execCommand !== undefined) {
            this.#trackYieldedBackgroundTerminal(appended.execCommand);
        }
    }

    #moveActiveToolEntryToTranscriptTail(toolCallId: string): void {
        if (!this.#activeToolCallIds.has(toolCallId)) return;
        const index = this.#entries.findIndex((entry) => entry.id === toolCallId);
        if (index < 0 || index === this.#entries.length - 1) return;
        const [entry] = this.#entries.splice(index, 1);
        if (entry !== undefined) this.#entries.push(entry);
    }

    #formatToolCall(toolName: string, args: unknown): string {
        const record = this.#isRecord(args) ? args : {};
        const stringField = (key: string): string | undefined => {
            const value = record[key];
            return typeof value === "string" && value.length > 0 ? value : undefined;
        };

        const normalized = toolName.toLowerCase();
        if (normalized === "write_stdin") {
            const chars = record.chars;
            return typeof chars === "string" && chars.length > 0
                ? "Interacting with background terminal"
                : "Waiting for background terminal";
        }
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
            const shell = stringField("shell");
            const shellSuffix = shell === undefined ? "" : ` (Shell: ${this.#singleLine(shell)})`;
            const secrets = Array.isArray(record.secrets)
                ? record.secrets.filter((value): value is string => typeof value === "string")
                : [];
            const secretSuffix =
                secrets.length === 0
                    ? ""
                    : ` (Secrets: ${secrets.map((id) => this.#singleLine(id)).join(", ")})`;
            return `${this.#singleLine(command)}${shellSuffix}${secretSuffix}`;
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
        if (normalized === "resume_agent") return "Resume delegated work";

        return this.#toolDisplayName(toolName);
    }

    #createMcpToolCall(toolName: string, args: unknown): CodexMcpToolCall | undefined {
        const invocation = parseCodexMcpToolInvocation(toolName, args);
        return invocation === undefined ? undefined : { invocation, status: "active" };
    }

    #toolDisplayName(toolName: string): string {
        return humanizeToolName(toolName);
    }

    #formatToolResult(block: Pick<ToolResultBlock, "display" | "failure" | "toolName">): string {
        const display = block.display.length > 0 ? block.display : "(empty result)";
        return this.#singleLine(formatToolResultForDisplay({ ...block, display }));
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
                `${IMAGE_CHIP_BG}${IMAGE_CHIP_FG}${placeholder}${this.#theme.inputBackground}${this.#theme.primary}`,
        );
    }

    #fitLine(line: string, width: number): string {
        return truncateToWidth(line, width, "", true);
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
        const isStreaming = entry.id === this.#streamEntryId;
        const renderMarkdown = (text: string): readonly string[] =>
            renderAgentMarkdown({
                text,
                width: contentWidth,
                cwd: this.#cwd,
                theme: this.#theme,
            });
        let renderedMarkdown: readonly string[];
        if (isStreaming && containsMarkdownTable(entry.text)) {
            this.#assistantStreamingRender.discard(entry);
            const mutableTableRows = Math.max(1, this.#tui.terminal.rows - 8);
            renderedMarkdown = renderMarkdown(entry.text).slice(0, mutableTableRows);
        } else {
            renderedMarkdown = this.#assistantStreamingRender.render({
                entry,
                isStreaming,
                render: renderMarkdown,
                text: entry.text,
                width: contentWidth,
            });
        }
        const indent = " ".repeat(prefixWidth);
        return renderedMarkdown.map((line, index) =>
            this.#fitLine(`${index === 0 ? prefix : indent}${line}`, width),
        );
    }

    #renderThinkingEntry(entry: AppTranscriptEntry, width: number): string[] {
        const prefix = `${DIM}•${RESET} `;
        const prefixWidth = visibleWidth(prefix);
        const contentWidth = Math.max(1, width - prefixWidth);
        const renderedMarkdown = this.#thinkingStreamingRender.render({
            entry,
            isStreaming: this.#streamingThinkingEntryIds.has(entry.id),
            render: (text) =>
                renderAgentMarkdown({
                    text,
                    width: contentWidth,
                    cwd: this.#cwd,
                    theme: this.#theme,
                }),
            text: entry.text,
            width: contentWidth,
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
            if (this.#shouldRenderActivityAsLastMessage()) return [];
            return [this.#fitLine(`${DIM}• ${PENDING_TOOL_CALL_TITLE}${RESET}`, width)];
        }

        const toolName = entry.title ?? "tool";
        const active = this.#activeToolCallIds.has(entry.id);
        const awaitingApproval = this.#awaitingApprovalToolCallIds.has(entry.id);
        const stopped = this.#stoppedToolCallIds.has(entry.id);
        const verb = stopped
            ? "Stopped"
            : isError
              ? "Failed"
              : awaitingApproval
                ? "Awaiting approval"
                : this.#toolVerb(toolName, active);
        const dot =
            stopped || isError
                ? this.#theme.error
                : awaitingApproval
                  ? this.#theme.warning
                  : this.#theme.success;
        const callText = this.#singleLine(entry.text);
        const displayText = callText.length > 0 && callText !== toolName ? callText : toolName;
        if (toolName === "Write stdin" && active) return [];
        const title = `${dot}•${RESET} ${this.#theme.brand}${BOLD}${verb}${NOT_BOLD_OR_DIM}${this.#theme.primary} ${displayText}${RESET}`;
        const lines = [this.#fitLine(title, width)];
        const childRows: ChildRow[] = [];
        if (entry.permissionReview !== undefined && width >= 5) {
            childRows.push({ prefix: DIM, suffix: RESET, text: entry.permissionReview });
        }
        if (entry.detail !== undefined) {
            const detailText = entry.detail.length > 0 ? entry.detail : "(empty result)";
            childRows.push({
                prefix: DIM,
                suffix: RESET,
                text: detailText,
                wrap: isError,
            });
        }
        lines.push(
            ...renderChildRows(childRows, {
                afterMarker: `${RESET}${DIM}`,
                markerStyle: DIM,
                width,
            }),
        );
        return lines;
    }

    #renderMcpToolEntry(entry: AppTranscriptEntry, width: number): string[] {
        const call = entry.mcpToolCall;
        if (call === undefined) return [];
        const stopped = this.#stoppedToolCallIds.has(entry.id);
        let result = call.result;
        if (
            result === undefined &&
            entry.detail !== undefined &&
            call.status === "active" &&
            !stopped
        ) {
            result = entry.detail;
        }
        if (stopped && (result === undefined || (Array.isArray(result) && result.length === 0))) {
            result = "Interrupted.";
        }

        return renderCodexMcpToolCall(
            {
                invocation: call.invocation,
                ...(entry.permissionReview === undefined ? {} : { review: entry.permissionReview }),
                ...(result === undefined ? {} : { result }),
                status: stopped ? "error" : call.status,
            },
            {
                palette: {
                    accent: this.#theme.accent,
                    error: this.#theme.error,
                    primary: this.#theme.primary,
                    success: this.#theme.success,
                },
                width,
            },
        );
    }

    #renderFileDiffEntry(entry: AppTranscriptEntry, width: number): string[] {
        const diffs: readonly FileDiff[] = entry.fileDiffs ?? [];
        const visibleDiffs = diffs.slice(0, MAX_DIFF_FILES_PER_TOOL);
        const rowsPerFile = Math.max(
            1,
            Math.floor(MAX_DIFF_ROWS_PER_TOOL / Math.max(1, visibleDiffs.length)) - 1,
        );
        const palette =
            this.#theme.isLight === true ? CODEX_LIGHT_DIFF_PALETTE : CODEX_DARK_DIFF_PALETTE;
        const lines: string[] = [];
        if (entry.permissionReview !== undefined && width >= 5) {
            lines.push(
                ...renderChildRows(
                    [
                        {
                            prefix: DIM,
                            suffix: NOT_BOLD_OR_DIM,
                            text: sanitizeTerminalText(entry.permissionReview),
                        },
                    ],
                    { markerStyle: DIM, width },
                ),
            );
        }
        for (const [index, diff] of visibleDiffs.entries()) {
            if (index > 0) lines.push("");
            lines.push(...renderCodexFileDiff(diff, { maxRows: rowsPerFile, palette, width }));
        }
        const hiddenFiles =
            diffs.length -
            visibleDiffs.length +
            Math.max(0, Math.floor(entry.omittedFileDiffs ?? 0));
        const hiddenFilesLine =
            hiddenFiles === 0
                ? undefined
                : this.#fitLine(
                      `${DIM}… ${hiddenFiles} more file${hiddenFiles === 1 ? "" : "s"}${NOT_BOLD_OR_DIM}`,
                      width,
                  );
        if (hiddenFilesLine !== undefined) lines.push(hiddenFilesLine);
        if (lines.length <= MAX_DIFF_ROWS_PER_TOOL) return lines;
        const reservedTailRows = hiddenFilesLine === undefined ? 1 : 2;
        const visible = lines.slice(0, MAX_DIFF_ROWS_PER_TOOL - reservedTailRows);
        const hidden = lines.length - visible.length - (hiddenFilesLine === undefined ? 0 : 1);
        visible.push(
            this.#fitLine(
                `${DIM}… ${hidden} more row${hidden === 1 ? "" : "s"}${NOT_BOLD_OR_DIM}`,
                width,
            ),
        );
        if (hiddenFilesLine !== undefined) visible.push(hiddenFilesLine);
        return visible;
    }

    #renderNoticeEntry(
        title: string,
        text: string,
        width: number,
        color: string,
        childText = false,
    ): string[] {
        const safeTitle = this.#singleLine(title);
        const safeText = sanitizeTerminalText(text);
        if (childText) {
            return [
                this.#fitLine(`${color}•${RESET} ${BOLD}${safeTitle}${RESET}`, width),
                ...renderChildRows(
                    safeText.split("\n").map((line) => ({ text: line })),
                    { afterMarker: RESET, markerStyle: DIM, width },
                ),
            ];
        }
        const prefix = `${color}•${RESET} ${BOLD}${safeTitle}${NOT_BOLD_OR_DIM} `;
        const prefixWidth = visibleWidth(prefix);
        const wrapped = wrapTextWithAnsi(
            safeText.length === 0 ? " " : safeText,
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
            return `${this.#inputPrompt()}${marker}${this.#theme.secondary}${placeholder}${this.#theme.primary}`;
        }

        const firstCharacter = placeholder[0] ?? " ";
        const rest = placeholder.slice(firstCharacter.length);
        return `${this.#inputPrompt()}${marker}${CURSOR_BG}${CURSOR_FG}${firstCharacter}${RESET}${this.#theme.secondary}${rest}${this.#theme.primary}`;
    }

    #surfaceLine(line: string, width: number): string {
        return `${this.#theme.inputBackground}${this.#theme.primary}${this.#fitAndPadLine(line, width)}${RESET}`;
    }

    #inputSurfaceLine(line: string, width: number): string {
        const softened = this.#softenFakeCursor(line);
        return `${this.#theme.inputBackground}${this.#theme.primary}${this.#fitAndPadLine(this.#restoreInputSurface(softened), width)}${RESET}`;
    }

    #restoreInputSurface(line: string): string {
        return line.replaceAll(
            RESET,
            `${RESET}${this.#theme.inputBackground}${this.#theme.primary}`,
        );
    }

    #softenFakeCursor(line: string): string {
        return line.replace(
            /\x1b\[7m([\s\S]*?)\x1b\[(?:27|0)m/gu,
            `${CURSOR_BG}${CURSOR_FG}$1${this.#theme.inputBackground}${this.#theme.primary}`,
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

    #recordUserInput(createdAt: number): void {
        this.#lastUserInputAtMs = createdAt;
        if (this.#running) this.#activityStartedAtMs = createdAt;
    }

    #elapsedSinceLastUserInput(completedAt: number): number | undefined {
        if (this.#lastUserInputAtMs === undefined) return undefined;
        return Math.max(0, completedAt - this.#lastUserInputAtMs);
    }

    #appendTurnCompletion(elapsedMs: number): void {
        if (!this.#deferredTurnSeparator) return;
        this.#deferredTurnSeparator = false;
        const segmentElapsedMs = Math.max(
            0,
            this.#now() - (this.#workSegmentStartedAtMs ?? this.#lastUserInputAtMs ?? this.#now()),
        );
        this.#workSegmentStartedAtMs = undefined;
        const latest = this.#entries.at(-1);
        if (latest?.role === "separator") {
            latest.turnElapsedMs = segmentElapsedMs || elapsedMs;
            this.#requestRender();
            return;
        }
        this.#appendEntry({
            role: "separator",
            text: "",
            turnElapsedMs: segmentElapsedMs || elapsedMs,
        });
    }

    #markConcreteWorkCompleted(
        result: Pick<ToolResultBlock, "presentation" | "toolCallId" | "toolName">,
    ): void {
        const entry = this.#entries.find((candidate) => candidate.id === result.toolCallId);
        const normalized = result.toolName.toLowerCase();
        const concreteTool =
            (result.presentation !== undefined &&
                !(
                    result.presentation.type === "background_terminal_interaction" &&
                    result.presentation.input === ""
                )) ||
            entry?.mcpToolCall !== undefined ||
            normalized === "bash" ||
            normalized === "web_search" ||
            normalized === "websearch" ||
            normalized.startsWith("mcp__");
        if (!concreteTool) return;
        this.#deferredTurnSeparator = true;
        this.#workSegmentStartedAtMs ??= this.#lastUserInputAtMs ?? this.#now();
    }

    #recordClosedBackgroundTerminals(nextProcesses: readonly BashSessionActivity[]): void {
        const nextSessionIds = new Set(nextProcesses.map((process) => process.sessionId));
        const closed = [...this.#yieldedBackgroundTerminals].filter(
            ([sessionId]) => !nextSessionIds.has(sessionId),
        );
        if (closed.length === 0 || this.#stoppingBackgroundTerminals) return;

        for (const [sessionId, command] of closed) {
            this.#yieldedBackgroundTerminals.delete(sessionId);
            this.#appendEntry({
                backgroundTerminalCompletion: command,
                role: "event",
                text: command,
            });
        }
    }

    #trackYieldedBackgroundTerminal(
        presentation: NonNullable<AppTranscriptEntry["execCommand"]>,
    ): void {
        if (presentation.sessionId === undefined || this.#replayingInitialSessionEvents) return;
        this.#yieldedBackgroundTerminals.set(presentation.sessionId, presentation.command);
        this.#backgroundProcesses = this.#observedShellProcesses.filter((process) =>
            this.#yieldedBackgroundTerminals.has(process.sessionId),
        );
    }

    #recordSubagentCompletion(subagent: SubagentSummary): void {
        const outcome =
            subagent.status === "completed"
                ? "completed"
                : subagent.status === "suspended"
                  ? "was suspended"
                  : subagent.status === "aborted"
                    ? "was stopped"
                    : "failed";
        const displayText = `Background work "${subagent.description}" ${outcome}.`;
        const metricsDisplayText = `Background work "${subagent.description}" ${outcome} in ${this.#subagentMetrics(subagent)}.`;
        this.#renderedCompletionNotices.set(
            displayText,
            (this.#renderedCompletionNotices.get(displayText) ?? 0) + 1,
        );
        this.#recordCompletionNotice(metricsDisplayText, "Background work", "Background work ");
    }

    #recordWorkflowCompletion(workflow: WorkflowRun): void {
        const outcome =
            workflow.status === "completed"
                ? "completed"
                : workflow.status === "stopped"
                  ? "was stopped"
                  : "failed";
        const displayText = `Workflow ${humanizeWorkflowName(workflow.name)} ${outcome}.`;
        this.#recordCompletionNotice(displayText, "Workflow", "Workflow ");
    }

    #recordCompletionNotice(displayText: string, title: string, prefix: string): void {
        const count = this.#renderedCompletionNotices.get(displayText) ?? 0;
        this.#renderedCompletionNotices.set(displayText, count + 1);
        if (this.#renderedCompletionNotices.size > 100) {
            const oldest = this.#renderedCompletionNotices.keys().next().value;
            if (oldest !== undefined) this.#renderedCompletionNotices.delete(oldest);
        }
        this.#appendEntry({
            childText: title === "Background work",
            role: "event",
            title,
            text: displayText.startsWith(prefix) ? displayText.slice(prefix.length) : displayText,
        });
    }

    #consumeRenderedCompletionNotice(displayText: string): boolean {
        const count = this.#renderedCompletionNotices.get(displayText) ?? 0;
        if (count === 0) return false;
        if (count === 1) this.#renderedCompletionNotices.delete(displayText);
        else this.#renderedCompletionNotices.set(displayText, count - 1);
        return true;
    }

    #refreshToolActivityStatus(): void {
        if (this.#awaitingApprovalToolCallIds.size > 0) {
            this.#statusText = "Waiting for approval";
            return;
        }
        if (this.#runningToolCallIds.size === 0) {
            this.#statusText = "Working";
            return;
        }
        if (this.#runningToolCallIds.size === 1) {
            const toolCallId = this.#runningToolCallIds.values().next().value as string;
            const status = this.#toolStatusByCallId.get(toolCallId);
            if (status !== undefined && status.length > 0) {
                this.#statusText = status;
                return;
            }
        }
        this.#statusText = `Running ${this.#runningToolCallIds.size} tool${this.#runningToolCallIds.size === 1 ? "" : "s"}`;
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
        const prefix = `${DIM}◦${RESET} `;
        const frame = this.#activityAnimationFrame;
        const elapsed = this.#activityElapsedText();
        const elapsedText = elapsed ?? "0s";
        const elapsedSuffix = ` ${DIM}${this.#theme.secondary}(${elapsedText} · esc to interrupt)${RESET}`;

        return [
            this.#fitLine(
                `${prefix}${renderActivityWave(label, frame, this.#theme)}${elapsedSuffix}`,
                width,
            ),
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

    #inputPrompt(): string {
        return `${this.#theme.brand}${BOLD}›${NOT_BOLD_OR_DIM}${this.#theme.primary} `;
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
        serviceTier: ServiceTier | null = this.#agent.confirmedServiceTier ?? null,
    ): void {
        if (this.#onDefaultModelChange === undefined) {
            return;
        }

        void Promise.resolve(
            this.#onDefaultModelChange({
                modelId,
                providerId,
                effort,
                serviceTier,
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
                completionChime: this.#completionChime,
                durableGlobalEventQueue: this.#durableGlobalEventQueue,
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

        const suggestions = [...this.#slashCommands, ...this.#skillCommands].filter((command) => {
            if (command.value === "fast" && !this.#supportsFastInference()) {
                return false;
            }
            return (
                command.value.toLowerCase().startsWith(query) ||
                command.aliases.some((alias) => alias.toLowerCase().startsWith(query))
            );
        });
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
        return (this.#agent.model.id.split("/").at(-1) ?? this.#agent.model.id).toLowerCase();
    }

    #modelWithReasoningDisplayName(): string {
        const snapshot = this.#agent.snapshot();
        const effort = snapshot.effort ?? this.#agent.model.defaultThinkingLevel;
        const label =
            effort === undefined
                ? this.#modelDisplayName()
                : `${this.#modelDisplayName()} ${effort.toLowerCase()}`;
        return snapshot.serviceTier === "fast" ? `${label} fast` : label;
    }

    #supportsFastInference(): boolean {
        return this.#agent.provider.serviceTiers?.includes("fast") === true;
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

    #toolVerb(toolName: string, active: boolean): string {
        const normalized = toolName.toLowerCase();
        if (normalized.includes("bash") || normalized.includes("exec")) {
            return active ? "Running" : "Ran";
        }
        if (
            normalized.includes("grep") ||
            normalized.includes("find") ||
            normalized.includes("glob") ||
            normalized === "ls"
        ) {
            return active ? "Exploring" : "Explored";
        }
        if (normalized.includes("read") || normalized.includes("view")) {
            return active ? "Reading" : "Read";
        }
        if (
            normalized.includes("write") ||
            normalized.includes("edit") ||
            normalized.includes("patch")
        ) {
            return active ? "Editing" : "Edited";
        }

        return active ? "Using" : "Used";
    }

    #isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    #singleLine(text: string): string {
        return sanitizeTerminalText(text).replace(/\s+/gu, " ").trim();
    }

    #markTypingActivity(): void {
        this.#cursorVisible = true;
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
        if (!this.#stopped) this.#cursorVisible = true;
    }

    #stopCursorBlink(): void {
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

    #syncSubagentRefreshTimer(): void {
        if (this.#activeSubagentCount() === 0) {
            this.#stopSubagentRefreshTimer();
            return;
        }
        if (this.#subagentRefreshTimer !== undefined || this.#stopped) return;
        this.#subagentRefreshTimer = setInterval(() => this.#requestRender(), 1_000);
        this.#subagentRefreshTimer.unref?.();
    }

    #stopSubagentRefreshTimer(): void {
        if (this.#subagentRefreshTimer === undefined) return;
        clearInterval(this.#subagentRefreshTimer);
        this.#subagentRefreshTimer = undefined;
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
        this.#editor.addToHistory(submission.displayText);
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

    #setRunning(running: boolean): void {
        this.#lastEscapeAtMs = undefined;
        this.#running = running;
    }
}
