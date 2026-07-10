import type { AssistantMessage, AssistantMessageEvent, InferenceStream } from "./types.js";

export function createInferenceStream(
    run: () => AsyncGenerator<AssistantMessageEvent, AssistantMessage>,
): InferenceStream {
    let resolveResult: (message: AssistantMessage) => void;
    let rejectResult: (error: unknown) => void;
    const resultPromise = new Promise<AssistantMessage>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });
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

            try {
                const result = yield* run();
                resolveResult(result);
            } catch (error) {
                rejectResult(error);
                throw error;
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
