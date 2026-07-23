import { resolveAutoCompactWindow } from "./resolveAutoCompactWindow.js";
import type { Model } from "@slopus/rig-execution";

const MAX_OUTPUT_RESERVE = 20_000;
const SUMMARY_SAFETY_RESERVE = 13_000;

export function resolveAutoCompactThreshold(model: Model): number {
    const window = resolveAutoCompactWindow(model);
    return Math.max(0, window - Math.min(window, MAX_OUTPUT_RESERVE) - SUMMARY_SAFETY_RESERVE);
}
