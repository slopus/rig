import { createInferenceStream } from "../providers/createInferenceStream.js";
import { defineProvider, type Provider, type StreamOptions } from "../providers/types.js";
import type { DebugLog } from "./DebugLog.js";

export interface CreateDebugProviderOptions {
    log: DebugLog;
    runId: string;
    source: "agent" | "title";
}

export function createDebugProvider(
    provider: Provider,
    options: CreateDebugProviderOptions,
): Provider {
    let inference = 0;

    return defineProvider({
        id: provider.id,
        models: provider.models,
        ...(provider.serviceTiers === undefined ? {} : { serviceTiers: provider.serviceTiers }),
        stream(model, context, streamOptions = {}) {
            const inferenceId = `${options.source}-${String(++inference).padStart(4, "0")}`;
            return createInferenceStream(async function* () {
                try {
                    await options.log.record("inference-request", {
                        context,
                        inferenceId,
                        model,
                        options: serializableStreamOptions(streamOptions),
                        providerId: provider.id,
                        runId: options.runId,
                        source: options.source,
                    });
                    const stream = provider.stream(model, context, streamOptions);
                    for await (const event of stream) {
                        await options.log.record("inference-event", {
                            event,
                            inferenceId,
                            runId: options.runId,
                            source: options.source,
                        });
                        yield event;
                    }
                    const message = await stream.result();
                    await options.log.record("inference-response", {
                        inferenceId,
                        message,
                        runId: options.runId,
                        source: options.source,
                    });
                    return message;
                } catch (error) {
                    await options.log
                        .record("inference-error", {
                            error,
                            inferenceId,
                            runId: options.runId,
                            source: options.source,
                        })
                        .catch(() => undefined);
                    throw error;
                }
            });
        },
    });
}

function serializableStreamOptions(options: StreamOptions): Record<string, unknown> {
    return {
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        ...(options.serviceTier === undefined ? {} : { serviceTier: options.serviceTier }),
        ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
        ...(options.signal === undefined
            ? {}
            : {
                  signal: {
                      aborted: options.signal.aborted,
                      ...(options.signal.reason === undefined
                          ? {}
                          : { reason: options.signal.reason }),
                  },
              }),
    };
}
