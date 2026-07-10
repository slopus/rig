import { describe, expect, it } from "vitest";

import type { SessionSummary } from "../protocol/index.js";
import { formatSessionSummaries } from "./formatSessionSummaries.js";

describe("formatSessionSummaries", () => {
    it("prints only rows that fit on screen", () => {
        const lines = formatSessionSummaries(
            [
                sessionSummary({ id: "session-1", title: "First" }),
                sessionSummary({ id: "session-2", title: "Second" }),
                sessionSummary({ id: "session-3", title: "Third" }),
            ],
            { columns: 120, rows: 3 },
        );

        expect(lines).toHaveLength(3);
        expect(lines.join("\n")).toContain("session-1");
        expect(lines.join("\n")).toContain("session-2");
        expect(lines.join("\n")).not.toContain("session-3");
    });

    it("truncates lines to terminal width", () => {
        const lines = formatSessionSummaries(
            [sessionSummary({ title: "A very long title that does not fit" })],
            { columns: 24, rows: 2 },
        );

        expect(lines[0]?.length).toBeLessThanOrEqual(24);
        expect(lines[1]?.length).toBeLessThanOrEqual(24);
    });
});

function sessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        createdAt: 1_700_000_000_000,
        cwd: "/tmp/rig-monit-test",
        id: "session-1",
        lastMessageAt: 1_700_000_000_000,
        modelId: "openai/gpt-5.5",
        providerId: "codex",
        status: "completed",
        titleStatus: "ready",
        updatedAt: 1_700_000_001_000,
        ...overrides,
    };
}
