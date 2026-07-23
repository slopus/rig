import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

export function createCodexBedrockRequest(
    request: ResponseCreateParamsStreaming,
): ResponseCreateParamsStreaming {
    const output = structuredClone(request) as ResponseCreateParamsStreaming &
        Record<string, unknown>;
    const normalizedInput = (output.input as unknown[]).map((item) => {
        if (
            typeof item !== "object" ||
            item === null ||
            (item as { type?: unknown }).type !== "message"
        )
            return item;
        const message = item as { content?: unknown };
        if (typeof message.content !== "string") return item;
        return {
            ...message,
            content: [{ type: "input_text", text: message.content }],
        };
    });
    output.input = normalizedInput.reduce<unknown[]>((items, item) => {
        const previous = items.at(-1) as
            | { content?: unknown[]; role?: unknown; type?: unknown }
            | undefined;
        const current = item as { content?: unknown[]; role?: unknown; type?: unknown };
        if (
            previous?.type === "message" &&
            previous.role === "developer" &&
            current.type === "message" &&
            current.role === "developer" &&
            Array.isArray(previous.content) &&
            Array.isArray(current.content)
        ) {
            previous.content.push(...current.content);
        } else {
            items.push(item);
        }
        return items;
    }, []) as never;
    return output;
}
