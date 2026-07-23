import type { AnyDefinedTool, ToolResultBlock } from "./types.js";
import { boundToolResultContent } from "./boundToolResultContent.js";

export function createToolResultBlock(
    tool: AnyDefinedTool,
    args: unknown,
    result: unknown,
    toolCallId: string,
    vendor?: unknown,
): ToolResultBlock {
    const isError = tool.isError as ((result: unknown) => boolean) | undefined;
    const toLLM = tool.toLLM as (result: unknown) => ToolResultBlock["rendered"];
    const toPresentation = tool.toPresentation as
        | ((result: unknown, args: unknown) => ToolResultBlock["presentation"])
        | undefined;
    const toTrustedUserEvidence = tool.toTrustedUserEvidence as
        | ((result: unknown, args: unknown) => ToolResultBlock["trustedUserEvidence"])
        | undefined;
    const toUI = tool.toUI as (result: unknown, args: unknown) => string;
    const resultIsError = isError?.(result);
    const presentation = resultIsError === true ? undefined : toPresentation?.(result, args);
    const trustedUserEvidence =
        resultIsError === true ? undefined : toTrustedUserEvidence?.(result, args);

    return {
        type: "tool_result",
        toolCallId,
        toolName: tool.name,
        rendered: boundToolResultContent(toLLM(result)),
        display: toUI(result, args),
        ...(resultIsError === undefined ? {} : { isError: resultIsError }),
        ...(presentation === undefined ? {} : { presentation }),
        ...(trustedUserEvidence === undefined ? {} : { trustedUserEvidence }),
        ...(vendor === undefined ? {} : { vendor }),
    };
}
