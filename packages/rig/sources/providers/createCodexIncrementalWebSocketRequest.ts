import { isDeepStrictEqual } from "node:util";

export interface CodexWebSocketContinuation {
    lastRequest: Record<string, unknown>;
    responseId: string;
    responseItems: readonly unknown[];
}

export function createCodexIncrementalWebSocketRequest(
    request: Record<string, unknown>,
    continuation: CodexWebSocketContinuation | undefined,
): { continuationUsed: boolean; request: Record<string, unknown> } {
    if (continuation === undefined) {
        return { continuationUsed: false, request };
    }
    const {
        input: _currentInput,
        previous_response_id: _currentResponse,
        ...currentProperties
    } = request;
    const {
        input: _previousInput,
        previous_response_id: _previousResponse,
        ...previousProperties
    } = continuation.lastRequest;
    if (!isDeepStrictEqual(currentProperties, previousProperties)) {
        return { continuationUsed: false, request };
    }
    const previousInput = Array.isArray(continuation.lastRequest.input)
        ? continuation.lastRequest.input
        : [];
    const currentInput = Array.isArray(request.input) ? request.input : [];
    const baseline = [...previousInput, ...continuation.responseItems];
    if (
        currentInput.length < baseline.length ||
        !isDeepStrictEqual(currentInput.slice(0, baseline.length), baseline)
    ) {
        return { continuationUsed: false, request };
    }
    return {
        continuationUsed: true,
        request: {
            ...request,
            input: currentInput.slice(baseline.length),
            previous_response_id: continuation.responseId,
        },
    };
}
