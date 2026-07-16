export function createAbortRequestKey(options: {
    continuePendingSteering?: boolean;
    expectedRunId?: string;
    pauseDescendants?: boolean;
    steeringMessageIds?: readonly string[];
}): string {
    return JSON.stringify([
        options.continuePendingSteering === true,
        options.expectedRunId ?? null,
        options.pauseDescendants !== false,
        options.continuePendingSteering === true ? (options.steeringMessageIds ?? null) : null,
    ]);
}
