import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";

import type { SessionEvent } from "@/core/SessionEvent.js";
import {
    mapGrokResponseStream,
    type GrokRunResult,
} from "@/vendors/grok/impl/mapGrokResponseStream.js";

/** Maps the OpenAI Responses event protocol used by Codex, Grok, and Bedrock Mantle. */
export async function* mapOpenAIResponseStream(
    stream: AsyncIterable<ResponseStreamEvent>,
    options: { signal?: AbortSignal; failureMessage: string },
): AsyncGenerator<SessionEvent, GrokRunResult> {
    return yield* mapGrokResponseStream(stream, {
        ...options,
        requireTerminalEvent: true,
        vendor: "codex",
    });
}
