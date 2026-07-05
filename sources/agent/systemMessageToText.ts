import { systemContentBlockToText } from "./systemContentBlockToText.js";
import type { SystemMessage } from "./types.js";

export function systemMessageToText(message: SystemMessage): string {
  return message.blocks.map(systemContentBlockToText).join("");
}
