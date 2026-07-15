import type { AgentContext, BashSessionSnapshot, ManagedSubagent } from "../../agent/index.js";

export interface GrokTaskResult {
    exit_code?: number;
    output?: string;
    status: string;
    task_id: string;
}

export async function readGrokTask(options: {
    context: AgentContext;
    taskId: string;
    timeoutMs?: number;
}): Promise<GrokTaskResult> {
    const terminalId = Number(options.taskId);
    if (Number.isInteger(terminalId) && terminalId >= 0) {
        const snapshot = await options.context.bash.readSession(terminalId, {
            waitMs: Math.max(0, options.timeoutMs ?? 0),
        });
        if (snapshot === undefined) {
            return { status: "not_found", task_id: options.taskId };
        }
        return fromTerminalSnapshot(snapshot);
    }

    const subagent = options.context.subagents
        ?.list()
        .find(
            (candidate) =>
                candidate.sessionId === options.taskId ||
                candidate.taskName === options.taskId ||
                candidate.path === options.taskId,
        );
    return subagent === undefined
        ? { status: "not_found", task_id: options.taskId }
        : fromManagedSubagent(subagent);
}

function fromTerminalSnapshot(snapshot: BashSessionSnapshot): GrokTaskResult {
    const output = [snapshot.stdout, snapshot.stderr].filter(Boolean).join("\n");
    return {
        task_id: String(snapshot.sessionId),
        status:
            snapshot.status === "running"
                ? "running"
                : snapshot.status === "killed"
                  ? "cancelled"
                  : snapshot.exitCode === 0
                    ? "completed"
                    : "failed",
        ...(snapshot.exitCode === null ? {} : { exit_code: snapshot.exitCode }),
        ...(output.length === 0 ? {} : { output }),
    };
}

function fromManagedSubagent(subagent: ManagedSubagent): GrokTaskResult {
    return {
        task_id: subagent.sessionId,
        status: subagent.status,
        output:
            subagent.status === "running"
                ? subagent.description
                : "The subagent result is delivered to the parent transcript when it completes.",
    };
}
