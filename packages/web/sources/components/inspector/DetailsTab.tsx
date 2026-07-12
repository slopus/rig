import { Separator } from "@/components/ui/separator";
import { formatRelativeTime } from "@/formatRelativeTime";
import type {
    ModelCatalog,
    PermissionMode,
    GoalStatus,
    ProtocolSession,
    SessionSummary,
    SubagentSummary,
} from "@/protocol";

import { DetailField } from "./DetailField";
import { EffortSelect } from "./EffortSelect";
import { ModelSelect } from "./ModelSelect";
import { GoalControls } from "./GoalControls";
import { PermissionSelect } from "./PermissionSelect";
import { ResetConversationButton } from "./ResetConversationButton";
import { SessionStatusBadge } from "./SessionStatusBadge";
import { SubagentList } from "./SubagentList";

export interface DetailsTabProps {
    catalog: ModelCatalog | undefined;
    changeEffort: (effort: string | undefined) => Promise<void>;
    changeModel: (providerId: string, modelId: string) => Promise<void>;
    changePermissionMode: (permissionMode: PermissionMode) => Promise<void>;
    changeGoalStatus: (status: GoalStatus) => Promise<void>;
    clearGoal: () => Promise<void>;
    isRunning: boolean;
    messageCount: number;
    onOpenSubagent: (sessionId: string) => void;
    reset: () => Promise<void>;
    setGoal: (objective: string) => Promise<void>;
    session: ProtocolSession;
    summary: SessionSummary | undefined;
    subagents: readonly SubagentSummary[];
    toolCallCount: number;
}

function exactTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}

/** The Details tab of the inspector: identity, model controls, stats, reset. */
export function DetailsTab(props: DetailsTabProps) {
    const { catalog, session, summary } = props;
    const isSubagent = session.agent.type === "subagent";

    const currentModel =
        catalog?.models.find((model) => model.id === session.modelId) ??
        session.models.find((model) => model.id === session.modelId);

    return (
        <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
                <h2 className="text-sm leading-snug font-medium break-words text-foreground">
                    {session.title !== undefined && session.title !== ""
                        ? session.title
                        : "Untitled session"}
                </h2>
                <SessionStatusBadge status={session.status} />
                {isSubagent && (
                    <p className="text-xs text-muted-foreground">
                        Subagent history · Level {session.agent.depth}
                    </p>
                )}
            </div>

            <Separator className="bg-border/60" />

            <DetailField label="Working directory">
                <p className="font-mono text-xs leading-relaxed break-all text-foreground/90">
                    {session.cwd}
                </p>
            </DetailField>

            <DetailField label="Model">
                <ModelSelect
                    catalog={catalog}
                    disabled={session.modelLocked || isSubagent}
                    modelId={session.modelId}
                    onChangeModel={props.changeModel}
                    providerId={session.providerId}
                />
                {(session.modelLocked || isSubagent) && (
                    <p className="text-xs text-muted-foreground">
                        {isSubagent
                            ? "The model cannot be changed for a completed subagent step."
                            : "Wait for the active response to finish before changing models."}
                    </p>
                )}
            </DetailField>

            <DetailField label="Reasoning effort">
                <EffortSelect
                    disabled={isSubagent}
                    effort={session.effort}
                    levels={currentModel?.thinkingLevels ?? []}
                    onChangeEffort={props.changeEffort}
                />
            </DetailField>

            <DetailField label="Permissions">
                <PermissionSelect
                    disabled={isSubagent}
                    onChangePermissionMode={props.changePermissionMode}
                    permissionMode={session.permissionMode}
                />
            </DetailField>

            {!isSubagent && (
                <DetailField label="Goal">
                    <GoalControls
                        changeStatus={props.changeGoalStatus}
                        clear={props.clearGoal}
                        goal={session.goal}
                        set={props.setGoal}
                    />
                </DetailField>
            )}

            {session.mcpServers.length > 0 && (
                <DetailField label="MCP servers">
                    <div className="space-y-2">
                        {session.mcpServers.map((server) => (
                            <div
                                className="rounded-md border border-border/60 px-2.5 py-2"
                                key={server.name}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="truncate font-mono text-xs text-foreground/90">
                                        {server.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {server.status === "connected"
                                            ? `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`
                                            : server.status === "disabled"
                                              ? "Disabled"
                                              : server.status === "blocked"
                                                ? "Blocked"
                                                : "Connection failed"}
                                    </span>
                                </div>
                                {server.errorMessage !== undefined && (
                                    <p className="mt-1 text-xs leading-relaxed text-destructive">
                                        {server.errorMessage}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </DetailField>
            )}

            {session.tasks.length > 0 && (
                <DetailField label="Tasks">
                    <div className="space-y-2">
                        {session.tasks.map((task) => (
                            <div
                                className="rounded-md border border-border/60 px-2.5 py-2"
                                key={task.id}
                            >
                                <div className="flex items-start gap-2">
                                    <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                        #{task.id}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs leading-relaxed text-foreground/90">
                                            {task.subject}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                            {task.status === "completed"
                                                ? "Completed"
                                                : task.status === "in_progress"
                                                  ? "In progress"
                                                  : "Pending"}
                                            {task.blockedBy.length > 0
                                                ? ` · Blocked by ${task.blockedBy.map((id) => `#${id}`).join(", ")}`
                                                : ""}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </DetailField>
            )}

            <Separator className="bg-border/60" />

            <div className="grid grid-cols-2 gap-4">
                <DetailField label="Created">
                    <p
                        className="text-xs text-foreground/90"
                        title={summary !== undefined ? exactTime(summary.createdAt) : undefined}
                    >
                        {summary !== undefined
                            ? formatRelativeTime(summary.createdAt)
                            : "Not available yet"}
                    </p>
                </DetailField>
                <DetailField label="Last updated">
                    <p
                        className="text-xs text-foreground/90"
                        title={summary !== undefined ? exactTime(summary.updatedAt) : undefined}
                    >
                        {summary !== undefined
                            ? formatRelativeTime(summary.updatedAt)
                            : "Not available yet"}
                    </p>
                </DetailField>
                <DetailField label="Messages">
                    <p className="text-xs text-foreground/90">{props.messageCount}</p>
                </DetailField>
                <DetailField label="Tool calls">
                    <p className="text-xs text-foreground/90">{props.toolCallCount}</p>
                </DetailField>
            </div>

            <Separator className="bg-border/60" />

            {props.subagents.length > 0 && (
                <>
                    <SubagentList
                        onOpenSubagent={props.onOpenSubagent}
                        subagents={props.subagents}
                    />
                    <Separator className="bg-border/60" />
                </>
            )}

            {isSubagent ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                    This subagent history is read-only and cannot be resumed or reset.
                </p>
            ) : (
                <ResetConversationButton disabled={props.isRunning} onReset={props.reset} />
            )}
        </div>
    );
}
