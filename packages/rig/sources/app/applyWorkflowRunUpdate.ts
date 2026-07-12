import type { WorkflowRun, WorkflowRunUpdate } from "../workflows/index.js";

export function applyWorkflowRunUpdate(
    workflows: readonly WorkflowRun[],
    update: WorkflowRunUpdate,
): readonly WorkflowRun[] {
    const index = workflows.findIndex((workflow) => workflow.runId === update.runId);
    if (index < 0) {
        if (
            update.agentCount === undefined ||
            update.description === undefined ||
            update.name === undefined ||
            update.startedAt === undefined ||
            update.status === undefined ||
            update.taskId === undefined
        ) {
            return workflows;
        }
        const created: WorkflowRun = {
            agentCount: update.agentCount,
            description: update.description,
            ...(update.error === undefined ? {} : { error: update.error }),
            ...(update.finishedAt === undefined ? {} : { finishedAt: update.finishedAt }),
            logs: update.log === undefined ? [] : [update.log],
            name: update.name,
            ...(update.output === undefined ? {} : { output: update.output }),
            ...(update.phase === undefined ? {} : { phase: update.phase }),
            runId: update.runId,
            startedAt: update.startedAt,
            status: update.status,
            taskId: update.taskId,
        };
        return [created, ...workflows].sort((left, right) => right.startedAt - left.startedAt);
    }

    const existing = workflows[index];
    if (existing === undefined) return workflows;
    const { log, ...changes } = update;
    const next: WorkflowRun = {
        ...existing,
        ...changes,
        logs: log === undefined ? existing.logs : [...existing.logs.slice(-199), log],
    };
    return workflows.map((workflow, workflowIndex) => (workflowIndex === index ? next : workflow));
}
