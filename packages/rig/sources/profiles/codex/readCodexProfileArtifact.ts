import { readFileSync } from "node:fs";

import type { CodexProfileCapture } from "./types.js";

export function readCodexProfilePrompt(stem: string): string {
    return readFileSync(new URL(`./${stem}.md`, import.meta.url), "utf8");
}

export function readCodexProfileCapture(stem: string): CodexProfileCapture {
    return JSON.parse(
        readFileSync(new URL(`./${stem}.capture.json`, import.meta.url), "utf8"),
    ) as CodexProfileCapture;
}
