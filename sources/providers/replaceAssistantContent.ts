import type { AssistantContent } from "./types.js";

export function replaceAssistantContent(
    content: readonly AssistantContent[],
    contentIndex: number,
    replacement: AssistantContent,
): readonly AssistantContent[] {
    const nextContent = [...content];
    nextContent[contentIndex] = replacement;
    return nextContent;
}
