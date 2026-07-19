import type { UserInputContext } from "../agent/context/UserInputContext.js";

export async function requestAutoPermissionApproval(options: {
    action: string;
    batchId: string;
    reason: string;
    signal?: AbortSignal;
    toolArguments: unknown;
    toolCallId: string;
    toolCallIndex: number;
    toolName: string;
    userInput: UserInputContext | undefined;
}): Promise<boolean> {
    if (options.userInput === undefined) return false;
    const requestId = `${options.toolCallId}:permission`;
    const response = await options.userInput.request(
        {
            requestId,
            questions: [
                {
                    header: "Permission",
                    id: "permission",
                    multiSelect: false,
                    options: [
                        {
                            label: "Allow once",
                            description: `Permit ${options.action} for this tool call only.`,
                        },
                        {
                            label: "Deny",
                            description: "Keep the current restrictions and reject this tool call.",
                        },
                    ],
                    question: `${options.reason} Allow ${options.action}?`,
                },
            ],
        },
        {
            durable: {
                batchId: options.batchId,
                kind: "permission",
                permission: { action: options.action, reason: options.reason },
                toolArguments: options.toolArguments,
                toolCallId: options.toolCallId,
                toolCallIndex: options.toolCallIndex,
                toolName: options.toolName,
            },
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
    );
    return response.answers.permission?.includes("Allow once") ?? false;
}
