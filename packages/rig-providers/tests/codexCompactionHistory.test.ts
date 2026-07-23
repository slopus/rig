import { describe, expect, it } from "vitest";

import { preserveCodexCompactionMessages } from "@/vendors/codex/impl/preserveCodexCompactionMessages.js";
import { preserveCodexLocalCompactionMessages } from "@/vendors/codex/impl/preserveCodexLocalCompactionMessages.js";
import { truncateCodexText } from "@/vendors/codex/impl/truncateCodexText.js";
import { context_checkpoint_summary_prefix } from "@/vendors/codex/prompts/context_checkpoint_compaction_instructions.js";

describe("Codex remote-v2 compaction history", () => {
    it("retains only user messages and middle-truncates at 64k UTF-8 approximate tokens", () => {
        const oversized = `prefix-${"x".repeat(300_000)}-suffix`;

        const preserved = preserveCodexCompactionMessages([
            { role: "system", content: "regenerated initial context" },
            { role: "user", content: "old user message" },
            { role: "assistant", content: "old assistant response" },
            { role: "user", content: oversized },
        ]);

        expect(preserved).toHaveLength(1);
        expect(preserved[0]?.role).toBe("user");
        expect(Buffer.byteLength(preserved[0]?.content ?? "")).toBeLessThan(64_000 * 4 + 64);
        expect(preserved[0]?.content).toMatch(/^prefix-/u);
        expect(preserved[0]?.content).toMatch(/-suffix$/u);
        expect(preserved[0]?.content).toContain("tokens truncated");
    });

    it("counts non-ASCII bytes and never expands the one-token remainder", () => {
        const newest = "x".repeat(63_999 * 4);
        const older = `begin-${"😀".repeat(100)}-end`;
        const preserved = preserveCodexCompactionMessages([
            { role: "user", content: older },
            { role: "user", content: newest },
        ]);

        expect(preserved).toHaveLength(2);
        expect(preserved[0]?.content).not.toBe(older);
        expect(preserved[0]?.content).toMatch(/^be/u);
        expect(preserved[0]?.content).toMatch(/nd$/u);
        expect(preserved[0]?.content).not.toContain("�");
        expect(Buffer.byteLength(preserved[0]?.content ?? "")).toBeLessThan(100);
    });
});

describe("Codex local compaction history", () => {
    it("drops prior summaries and middle-truncates the newest 20k approximate user tokens", () => {
        const newest = `newest-${"x".repeat(100_000)}-ending`;
        const preserved = preserveCodexLocalCompactionMessages([
            { role: "user", content: "old user message" },
            {
                role: "user",
                content: `${context_checkpoint_summary_prefix}\nold synthetic summary`,
            },
            { role: "assistant", content: "assistant response" },
            { role: "user", content: newest },
        ]);

        expect(preserved).toEqual([{ role: "user", content: truncateCodexText(newest, 20_000) }]);
        expect(preserved[0]?.content).toMatch(/^newest-/u);
        expect(preserved[0]?.content).toMatch(/-ending$/u);
        expect(preserved[0]?.content).toContain("tokens truncated");
        expect(JSON.stringify(preserved)).not.toContain("old synthetic summary");
    });

    it("uses UTF-8 bytes without splitting multi-byte characters", () => {
        const truncated = truncateCodexText(`start-${"😀".repeat(20)}-end`, 4);
        expect(truncated).toMatch(/^start-/u);
        expect(truncated).toMatch(/-end$/u);
        expect(truncated).not.toContain("�");
    });
});
