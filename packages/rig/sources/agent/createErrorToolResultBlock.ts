import type { ToolResultBlock, ToolResultFailure } from "./types.js";
import { boundToolResultContent } from "./boundToolResultContent.js";

export function createErrorToolResultBlock(
    toolCall: { id: string; name: string; vendor?: unknown },
    message: string,
    failure?: ToolResultFailure,
): ToolResultBlock {
    const rendered = boundToolResultContent([{ type: "text", text: message }]);
    const boundedMessage = rendered
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    const boundedFailureMessage =
        failure?.message === undefined
            ? undefined
            : boundToolResultContent([{ type: "text", text: failure.message }])
                  .filter((block) => block.type === "text")
                  .map((block) => block.text)
                  .join("");
    return {
        type: "tool_result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        rendered,
        display: boundedMessage,
        isError: true,
        ...(toolCall.vendor === undefined ? {} : { vendor: toolCall.vendor }),
        ...(failure === undefined
            ? {}
            : {
                  failure: {
                      ...failure,
                      ...(boundedFailureMessage === undefined
                          ? {}
                          : { message: boundedFailureMessage }),
                  },
              }),
    };
}
