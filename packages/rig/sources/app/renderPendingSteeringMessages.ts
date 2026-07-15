import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const PREVIEW_LINE_LIMIT = 3;

export function renderPendingSteeringMessages(
    messages: readonly string[],
    width: number,
): string[] {
    if (messages.length === 0) return [];

    const safeWidth = Math.max(1, width);
    const lines = [
        truncateToWidth(
            `${DIM}  • Messages to be submitted after next tool call${RESET}`,
            safeWidth,
            "",
            true,
        ),
    ];
    const prefix = "  ↳ ";
    const indent = " ".repeat(visibleWidth(prefix));
    for (const message of messages) {
        const wrapped = wrapTextWithAnsi(
            message,
            Math.max(1, safeWidth - visibleWidth(prefix)),
        ).slice(0, PREVIEW_LINE_LIMIT);
        lines.push(
            ...wrapped.map((line, index) =>
                truncateToWidth(
                    `${DIM}${index === 0 ? prefix : indent}${line}${RESET}`,
                    safeWidth,
                    "",
                    true,
                ),
            ),
        );
    }
    return lines;
}
