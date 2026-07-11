export function parseBackgroundTaskId(taskId: string): number {
    const parsed = Number(taskId);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error("The background task identifier is invalid.");
    }
    return parsed;
}
