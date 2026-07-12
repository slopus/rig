/* eslint-disable no-control-regex -- Tests intentionally strip terminal ANSI controls. */
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { createSelectionPanel } from "./createSelectionPanel.js";

describe("createSelectionPanel", () => {
    it("wraps a long subtitle without overflowing or losing its approval details", () => {
        const subtitle =
            "Approve running the complete command that writes auto-denied.txt? · 1 of 1";
        const panel = createSelectionPanel({
            items: [
                {
                    description: "Permit this exact command once.",
                    label: "Allow once",
                    value: "allow",
                },
                {
                    description: "Keep the current restrictions.",
                    label: "Deny",
                    value: "deny",
                },
            ],
            onCancel: () => {},
            onSelect: () => {},
            subtitle,
            title: "Permission",
        });

        const rendered = panel.render(32);
        const text = stripAnsi(rendered.join("\n"));

        expect(text.replace(/\s+/gu, " ")).toContain(subtitle);
        expect(rendered.every((line) => visibleWidth(line) === 32)).toBe(true);
        expect(text).toContain("auto-denied.txt? · 1");
        expect(text).toContain("of 1");
    });

    it("removes terminal controls from every user-visible field", () => {
        const titleControl = "\x1b]0;CORRUPTED_TITLE\x07";
        const eraseControl = "\x1b[2J";
        const panel = createSelectionPanel({
            items: [
                {
                    description: `Before ${titleControl} after`,
                    label: `Allow ${eraseControl} once`,
                    value: "allow",
                },
            ],
            onCancel: () => {},
            onSelect: () => {},
            subtitle: `Question ${titleControl} remains visible`,
            title: `Permission ${eraseControl}`,
        });

        const rendered = panel.render(60).join("\n");
        const text = stripAnsi(rendered);

        expect(rendered).not.toContain(titleControl);
        expect(rendered).not.toContain(eraseControl);
        expect(text).not.toContain("CORRUPTED_TITLE");
        expect(text).toContain("Permission");
        expect(text).toContain("Question  remains visible");
        expect(text).toContain("Allow  once");
        expect(text).toContain("Before  after");
    });
});

function stripAnsi(value: string): string {
    return value.replace(/\x1b\[[0-9;]*m/gu, "");
}
