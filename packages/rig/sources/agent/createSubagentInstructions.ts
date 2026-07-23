const genericSubagentInstructionsMarker = "You are a subagent working on one delegated step.";

export function createSubagentInstructions(
    parentInstructions: string | undefined,
    depth: number,
    maxDepth: number,
    _modelId?: string,
): string {
    const previousSubagentInstructions = [
        parentInstructions?.indexOf(genericSubagentInstructionsMarker) ?? -1,
    ].filter((index) => index >= 0);
    const previousSubagentInstructionsStart =
        previousSubagentInstructions.length === 0 ? -1 : Math.min(...previousSubagentInstructions);
    const baseInstructions =
        previousSubagentInstructionsStart >= 0
            ? parentInstructions?.slice(0, previousSubagentInstructionsStart).trimEnd()
            : parentInstructions;
    const roleInstructions = `${genericSubagentInstructionsMarker} Complete the task independently and return a concise result to the parent agent.\n\nThe parent agent may send follow-up work after this step. Continue from your existing context when it does.`;
    return [
        baseInstructions,
        roleInstructions,
        depth < maxDepth
            ? `You may delegate focused work to another subagent. The current depth is ${depth} of ${maxDepth}.`
            : "You are at the maximum subagent depth and must complete the task directly.",
    ]
        .filter((part): part is string => part !== undefined && part.length > 0)
        .join("\n\n");
}
