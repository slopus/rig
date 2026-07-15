import { describe, expect, it } from "vitest";

import { renderPendingSteeringMessages } from "./renderPendingSteeringMessages.js";

describe("renderPendingSteeringMessages", () => {
    it("renders the Codex pending heading and ordered previews within the terminal width", () => {
        const rendered = renderPendingSteeringMessages(
            ["First steering message", "Second steering message"],
            40,
        );
        const plain = rendered.map((line) => stripAnsi(line).trimEnd());

        expect(plain).toEqual([
            "  • Messages to be submitted after next",
            "  ↳ First steering message",
            "  ↳ Second steering message",
        ]);
        expect(plain.every((line) => line.length <= 40)).toBe(true);
    });
});

function stripAnsi(value: string): string {
    return value.replace(/\x1b\[[0-9;]*m/gu, "");
}
