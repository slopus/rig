import type { Model } from "../../providers/types.js";

const DEFAULT_CONTEXT_WINDOW = 200_000;

export function resolveAutoCompactWindow(model: Model): number {
    const contextWindow = model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    return Math.min(contextWindow, model.autoCompactWindow ?? contextWindow);
}
