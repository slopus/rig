export function createSubagentInstructions(
    parentInstructions: string | undefined,
    depth: number,
    maxDepth: number,
): string {
    const previousSubagentInstructions = parentInstructions?.indexOf(
        "You are a subagent working on one delegated step.",
    );
    const baseInstructions =
        previousSubagentInstructions !== undefined && previousSubagentInstructions >= 0
            ? parentInstructions?.slice(0, previousSubagentInstructions).trimEnd()
            : parentInstructions;
    return [
        baseInstructions,
        "You are a subagent working on one delegated step. Complete the task independently and return a concise result to the parent agent.",
        "The parent agent may send follow-up work after this step. Continue from your existing context when it does.",
        depth < maxDepth
            ? `You may delegate focused work to another subagent. The current depth is ${depth} of ${maxDepth}.`
            : "You are at the maximum subagent depth and must complete the task directly.",
    ]
        .filter((part): part is string => part !== undefined && part.length > 0)
        .join("\n\n");
}
