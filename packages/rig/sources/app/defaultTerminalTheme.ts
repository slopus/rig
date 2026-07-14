import { DEFAULT_RIG_CONFIG } from "../config/index.js";
import { resolveTerminalTheme } from "./resolveTerminalTheme.js";

export const DEFAULT_TERMINAL_THEME = resolveTerminalTheme(DEFAULT_RIG_CONFIG.theme);
