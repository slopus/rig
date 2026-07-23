import type {
    ResponseInputItem,
    ResponseCreateParamsStreaming,
} from "openai/resources/responses/responses.js";

export function responseInputItems(
    input: ResponseCreateParamsStreaming["input"],
): ResponseInputItem[] {
    if (Array.isArray(input)) return [...input];
    if (typeof input === "string") return [{ role: "user", content: input }];
    return [];
}
