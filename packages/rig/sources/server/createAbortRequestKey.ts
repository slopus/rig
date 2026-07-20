export function createAbortRequestKey(options: {
    continuePendingSteering?: boolean;
    expectedRunId?: string;
    stopDescendants?: boolean;
    steeringMessageIds?: readonly string[];
}): string {
    return JSON.stringify([
        options.continuePendingSteering === true,
        options.expectedRunId ?? null,
        options.stopDescendants !== false,
        options.continuePendingSteering === true ? (options.steeringMessageIds ?? null) : null,
    ]);
}
