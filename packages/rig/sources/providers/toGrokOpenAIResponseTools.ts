import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import { toOpenAIResponseTools } from "./toOpenAIResponseTools.js";
import type { ServerTool, Tool } from "./types.js";

export function toGrokOpenAIResponseTools(
    tools: readonly Tool[],
    serverTools: readonly ServerTool[],
): NonNullable<ResponseCreateParamsStreaming["tools"]> {
    return [...toOpenAIResponseTools(tools), ...serverTools] as unknown as NonNullable<
        ResponseCreateParamsStreaming["tools"]
    >;
}
