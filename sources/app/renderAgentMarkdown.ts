import { Markdown, truncateToWidth, type DefaultTextStyle } from "@earendil-works/pi-tui";

import { createAgentMarkdownTheme } from "./createAgentMarkdownTheme.js";
import { sanitizeTerminalText } from "./sanitizeTerminalText.js";

const RESET = "\x1b[0m";
const TEXT_FG = "\x1b[38;5;252m";

const DEFAULT_TEXT_STYLE: DefaultTextStyle = {
    color: (text) => `${TEXT_FG}${text}${RESET}`,
};

export interface RenderAgentMarkdownOptions {
    text: string;
    width: number;
    cwd: string;
}

export function renderAgentMarkdown(options: RenderAgentMarkdownOptions): string[] {
    const width = Math.max(1, options.width);
    const text = sanitizeTerminalText(options.text).trimEnd();

    if (text.length === 0) {
        return [" ".repeat(width)];
    }

    const markdown = new Markdown(text, 0, 0, createAgentMarkdownTheme(), DEFAULT_TEXT_STYLE, {
        preserveBackslashEscapes: true,
        preserveOrderedListMarkers: true,
    });

    const rendered = markdown.render(width);
    if (rendered.length === 0) {
        return [" ".repeat(width)];
    }

    return rendered.map((line) => truncateToWidth(line, width, "", true));
}
