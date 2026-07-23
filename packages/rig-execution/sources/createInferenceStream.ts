import type { AssistantMessage, AssistantMessageEvent, InferenceStream } from "@/types.js";

export function createInferenceStream(
    run: () => AsyncGenerator<AssistantMessageEvent, AssistantMessage>,
): InferenceStream {
    let resolveResult: (message: AssistantMessage) => void;
    let rejectResult: (error: unknown) => void;
    const resultPromise = new Promise<AssistantMessage>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });
    // Iteration reports provider failures directly. Keep the parallel result promise
    // observed as well so a caller that exits the iterator on that failure cannot
    // trigger an unhandled rejection before (or instead of) calling result().
    void resultPromise.catch(() => {});
    let started = false;

    const drain = async () => {
        try {
            const generator = run();
            let next = await generator.next();
            while (!next.done) {
                next = await generator.next();
            }
            resolveResult(next.value);
        } catch (error) {
            rejectResult(error);
        }
    };

    return {
        async *[Symbol.asyncIterator]() {
            if (started) {
                throw new Error("Inference streams can only be consumed once.");
            }
            started = true;
            let resultSettled = false;

            try {
                const result = yield* run();
                resultSettled = true;
                resolveResult(result);
            } catch (error) {
                resultSettled = true;
                rejectResult(error);
                throw error;
            } finally {
                if (!resultSettled) {
                    rejectResult(
                        new Error(
                            "Inference stream iteration ended before a result was available.",
                        ),
                    );
                }
            }
        },
        result: async () => {
            if (!started) {
                started = true;
                void drain();
            }
            return resultPromise;
        },
    };
}
