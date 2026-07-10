import { MessagesSquareIcon } from "lucide-react";

import { DaemonHealthFooter } from "@/components/sidebar/DaemonHealthFooter";
import { NewSessionDialog } from "@/components/sidebar/NewSessionDialog";
import { SessionListRow } from "@/components/sidebar/SessionListRow";
import { Skeleton } from "@/components/ui/skeleton";
import type { HealthResponse, ProtocolSession, SessionSummary } from "@/protocol";

export interface SessionSidebarProps {
    /** Currently selected session id, if any. */
    activeSessionId: string | undefined;
    /** Last successful health response; provides the model catalog and readiness. */
    health: HealthResponse | undefined;
    /** Error from the health poll (daemon unreachable), if any. */
    healthError: string | undefined;
    /** True until the first session list poll settles. */
    isLoadingSessions: boolean;
    /** Called when the user clicks a session row. */
    onSelectSession: (sessionId: string) => void;
    /** Called after the New Session dialog successfully creates a session. */
    onSessionCreated: (session: ProtocolSession) => void;
    /** Triggers an immediate session list re-fetch (e.g. after creating a session). */
    refreshSessions: () => void;
    /** Error from the most recent session list poll, if it failed. */
    sessionListError: string | undefined;
    /** Session list, newest first as returned by the daemon. */
    sessions: readonly SessionSummary[];
}

function SessionListPlaceholder(props: { isLoading: boolean; listError: string | undefined }) {
    if (props.isLoading) {
        return (
            <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        );
    }
    if (props.listError !== undefined) {
        return (
            <div className="px-4 py-10 text-center">
                <p className="text-xs text-red-400">The session list could not be loaded.</p>
            </div>
        );
    }
    return (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessagesSquareIcon className="size-5 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
                No sessions yet. Create one to start chatting.
            </p>
        </div>
    );
}

export function SessionSidebar(props: SessionSidebarProps) {
    return (
        <aside className="flex w-72 shrink-0 flex-col border-r border-border/60 bg-background">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 pr-2 pl-4">
                <span className="text-[13px] font-semibold tracking-tight">Rig</span>
                <NewSessionDialog
                    catalog={props.health?.catalog}
                    daemonReady={props.health?.ready === true && props.healthError === undefined}
                    defaultCwd={props.sessions[0]?.cwd}
                    onSessionCreated={props.onSessionCreated}
                    refreshSessions={props.refreshSessions}
                />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {props.sessions.length === 0 ? (
                    <SessionListPlaceholder
                        isLoading={props.isLoadingSessions}
                        listError={props.sessionListError}
                    />
                ) : (
                    <ul className="flex flex-col gap-0.5">
                        {props.sessions.map((session) => (
                            <li key={session.id}>
                                <SessionListRow
                                    session={session}
                                    isActive={session.id === props.activeSessionId}
                                    onSelect={() => props.onSelectSession(session.id)}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <DaemonHealthFooter health={props.health} healthError={props.healthError} />
        </aside>
    );
}
