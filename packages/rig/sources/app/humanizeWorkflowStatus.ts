import type { WorkflowRunStatus } from "../workflows/index.js";

export function humanizeWorkflowStatus(status: WorkflowRunStatus): string {
    if (status === "completed") return "Completed";
    if (status === "error") return "Failed";
    if (status === "stopped") return "Stopped";
    return "Running";
}
