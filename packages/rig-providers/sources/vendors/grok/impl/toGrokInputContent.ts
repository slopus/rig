import type {
    ResponseInputImage,
    ResponseInputText,
} from "openai/resources/responses/responses.js";

import type { SessionInputContent } from "@/core/SessionContext.js";

export function toGrokInputContent(
    content: string,
    input?: SessionInputContent,
): string | Array<ResponseInputText | ResponseInputImage> {
    if (input === undefined) return content;
    return input.map((block) =>
        block.type === "text"
            ? { type: "input_text", text: block.text }
            : {
                  type: "input_image",
                  detail: "auto",
                  image_url: `data:${block.mimeType};base64,${block.data}`,
              },
    );
}
