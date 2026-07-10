import {
    CircleAlertIcon,
    MessageSquareIcon,
    MessagesSquareIcon,
    TriangleAlertIcon,
} from "lucide-react";
import { useMemo } from "react";

import {
    Conversation,
    ConversationContent,
    ConversationScrollButton,
} from "@/components/ai/conversation";
import { Loader } from "@/components/ai/loader";
import { Shimmer } from "@/components/ai/shimmer";
import { AgentMessageView } from "@/components/chat/AgentMessageView";
import { buildToolResultIndex } from "@/components/buildToolResultIndex";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { StreamingMessageView } from "@/components/chat/StreamingMessageView";
import { SubagentHistoryHeader } from "@/components/chat/SubagentHistoryHeader";
import { UserMessageBubble } from "@/components/chat/UserMessageBubble";
import { UserInputPanel } from "@/components/chat/UserInputPanel";
import type { ActiveSessionState } from "@/hooks/useActiveSession";
import type { SessionInterruption } from "@/protocol";

export interface ChatPanelProps {
    /**
     * The single shared useActiveSession instance owned by App.tsx (the same
     * object is passed to InspectorPanel — do not instantiate another).
     */
    activeSession: ActiveSessionState;
    /** True when the daemon reports ready; gates message submission. */
    daemonReady: boolean;
    /** Navigation depth, available before child metadata finishes loading. */
    historyDepth: number;
    /** Selected session id; undefined renders the "no session selected" state. */
    sessionId: string | undefined;
    /** Returns from a subagent history to its immediate parent. */
    onBackToParent: () => void;
    /** Opens a direct child's read-only history. */
    onOpenSubagent: (sessionId: string) => void;
}

function interruptionTitle(interruption: SessionInterruption): string {
    return interruption.reason === "crash"
        ? "The daemon crashed during a run"
        : "The daemon was shut down during a run";
}

export function ChatPanel({
    activeSession,
    daemonReady,
    historyDepth,
    onBackToParent,
    onOpenSubagent,
    sessionId,
}: ChatPanelProps) {
    const toolResults = useMemo(
        () => buildToolResultIndex(activeSession.messages),
        [activeSession.messages],
    );
    const visibleMessages = useMemo(
        () => activeSession.messages.filter((message) => message.role !== "system"),
        [activeSession.messages],
    );
    const subagentsByToolCallId = useMemo(
        () =>
            new Map(
                activeSession.subagents.flatMap((subagent) =>
                    subagent.parentToolCallId === undefined
                        ? []
                        : [[subagent.parentToolCallId, subagent] as const],
                ),
            ),
        [activeSession.subagents],
    );

    if (sessionId === undefined) {
        return (
            <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <MessagesSquareIcon className="size-6 text-muted-foreground" />
                <div className="space-y-1">
                    <h2 className="font-medium text-sm">No session selected</h2>
                    <p className="text-muted-foreground text-sm">
                        Pick a session from the list or create a new one to start chatting.
                    </p>
                </div>
            </section>
        );
    }

    if (activeSession.isLoading) {
        return (
            <section className="flex min-w-0 flex-1 flex-col">
                {historyDepth > 0 && (
                    <SubagentHistoryHeader
                        depth={historyDepth}
                        description="Subagent history"
                        onBack={onBackToParent}
                    />
                )}
                <div className="flex flex-1 flex-col items-center justify-center gap-3">
                    <Loader className="text-muted-foreground" size={20} />
                    <p className="text-muted-foreground text-sm">Loading conversation…</p>
                </div>
            </section>
        );
    }

    if (activeSession.loadError !== undefined) {
        return (
            <section className="flex min-w-0 flex-1 flex-col">
                {historyDepth > 0 && (
                    <SubagentHistoryHeader
                        depth={historyDepth}
                        description="Subagent history"
                        onBack={onBackToParent}
                    />
                )}
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                    <CircleAlertIcon className="size-6 text-destructive" />
                    <div className="space-y-1">
                        <h2 className="font-medium text-sm">The session could not be loaded</h2>
                        <p className="text-muted-foreground text-sm">{activeSession.loadError}</p>
                    </div>
                </div>
            </section>
        );
    }

    const partial = activeSession.streamingPartial;
    const hasPartialContent = partial !== undefined && partial.content.length > 0;
    const interruption = activeSession.session?.interruption;
    const session = activeSession.session;
    const isSubagent = historyDepth > 0 || session?.agent.type === "subagent";
    const pendingUserInput = activeSession.pendingUserInputs[0];
    const showLoader =
        activeSession.isRunning && !hasPartialContent && pendingUserInput === undefined;
    const isEmpty =
        visibleMessages.length === 0 &&
        !hasPartialContent &&
        !showLoader &&
        activeSession.runError === undefined &&
        activeSession.streamError === undefined &&
        interruption === undefined &&
        pendingUserInput === undefined;

    return (
        <section className="flex min-w-0 flex-1 flex-col">
            {isSubagent && session !== undefined && (
                <SubagentHistoryHeader
                    depth={session.agent.depth}
                    description={session.agent.description ?? session.title ?? "Delegated task"}
                    onBack={onBackToParent}
                />
            )}
            {isEmpty ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                    <MessageSquareIcon className="size-6 text-muted-foreground" />
                    <div className="space-y-1">
                        <h2 className="font-medium text-sm">No messages yet</h2>
                        <p className="text-muted-foreground text-sm">
                            Send a message below to start the conversation.
                        </p>
                    </div>
                </div>
            ) : (
                <Conversation className="flex-1" initial="instant">
                    <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-6 py-8">
                        {visibleMessages.map((message) =>
                            message.role === "user" ? (
                                <UserMessageBubble key={message.id} message={message} />
                            ) : (
                                <AgentMessageView
                                    isSessionRunning={activeSession.isRunning}
                                    key={message.id}
                                    message={message}
                                    onOpenSubagent={onOpenSubagent}
                                    subagentsByToolCallId={subagentsByToolCallId}
                                    toolResults={toolResults}
                                />
                            ),
                        )}
                        {hasPartialContent && <StreamingMessageView partial={partial} />}
                        {showLoader && (
                            <div className="flex items-center gap-2.5">
                                <Loader className="text-muted-foreground" size={14} />
                                <Shimmer className="text-sm" duration={1.5}>
                                    Working…
                                </Shimmer>
                            </div>
                        )}
                        {activeSession.runError !== undefined && (
                            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
                                <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
                                <div className="min-w-0">
                                    <p className="font-medium">The run failed</p>
                                    <p className="mt-0.5 break-words">{activeSession.runError}</p>
                                </div>
                            </div>
                        )}
                        {activeSession.streamError !== undefined && (
                            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-400 text-sm">
                                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                                <div className="min-w-0">
                                    <p className="font-medium">Live updates stopped</p>
                                    <p className="mt-0.5 break-words">
                                        {activeSession.streamError} Refresh the page to reconnect.
                                    </p>
                                </div>
                            </div>
                        )}
                        {interruption !== undefined && (
                            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-400 text-sm">
                                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                                <div className="min-w-0">
                                    <p className="font-medium">{interruptionTitle(interruption)}</p>
                                    <p className="mt-0.5 break-words">{interruption.message}</p>
                                </div>
                            </div>
                        )}
                    </ConversationContent>
                    <ConversationScrollButton />
                </Conversation>
            )}
            <div className="border-border/60 border-t">
                <div className="mx-auto w-full max-w-3xl px-6 pt-4 pb-5">
                    {pendingUserInput !== undefined && !isSubagent ? (
                        <UserInputPanel
                            isAborting={activeSession.isAborting}
                            key={pendingUserInput.requestId}
                            onAbort={() => void activeSession.abort()}
                            onAnswer={activeSession.answerUserInput}
                            request={pendingUserInput}
                        />
                    ) : (
                        <ChatComposer
                            daemonReady={daemonReady}
                            isAborting={activeSession.isAborting}
                            isRunning={activeSession.isRunning}
                            onAbort={() => void activeSession.abort()}
                            onSubmit={activeSession.submit}
                            readOnly={isSubagent}
                            sessionId={sessionId}
                        />
                    )}
                </div>
            </div>
        </section>
    );
}
