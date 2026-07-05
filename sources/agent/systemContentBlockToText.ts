import type { ContentBlock } from "./types.js";

export function systemContentBlockToText(block: ContentBlock): string {
  if (block.type === "text") {
    return block.text;
  }

  throw new Error("System image blocks are not supported by providers");
}
