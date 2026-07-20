import { afterEach, describe, expect, it } from "vitest";

import { captureScrollback, createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("optional completed turn compaction", () => {
    it("keeps the final answer and stats while preserving aborted and restorable details", async () => {
        const patch = [
            "*** Begin Patch",
            "*** Update File: note.txt",
            "@@",
            "-before",
            "+after",
            "*** End Patch",
        ].join("\n");
        const gym = await createGym({
            cols: 84,
            files: { "note.txt": "before\n" },
            inference: [
                {
                    content: [
                        { text: "COMPACTED_INTERMEDIATE_EXPLANATION", type: "text" },
                        {
                            arguments: { patch, workdir: "/workspace" },
                            id: "compact-turn-patch",
                            name: "apply_patch",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "COMPACTED_FINAL_ANSWER", type: "text" }] },
                {
                    completionDelayMs: 5_000,
                    content: [{ text: "ABORTED_PARTIAL_RESPONSE", type: "text" }],
                },
            ],
            rows: 24,
        });
        running.add(gym);

        submit(gym, "/configure");
        await gym.terminal.waitForText("Compact completed turns");
        for (let index = 0; index < 4; index += 1) gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Completed turn compaction enabled.");

        submit(gym, "Update the note and summarize the change.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("COMPACTED_FINAL_ANSWER") &&
                snapshot.text.includes("1 tool · 1 file · +1 -1") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the completed turn to compact to stats and its final answer",
            30_000,
        );
        expect(rowContaining(completed.rows, "COMPACTED_FINAL_ANSWER")).toBeLessThan(
            rowContaining(completed.rows, "Worked for"),
        );
        const compacted = await captureScrollback(gym);
        expect(compacted).toContain("Update the note and summarize the change.");
        expect(compacted).toContain("COMPACTED_FINAL_ANSWER");
        expect(compacted).not.toContain("COMPACTED_INTERMEDIATE_EXPLANATION");
        expect(compacted).not.toContain("Edited note.txt");

        submit(gym, "Start an answer that I will stop.");
        await gym.terminal.waitForText("ABORTED_PARTIAL_RESPONSE", 30_000);
        gym.terminal.press("escape");
        await gym.terminal.waitForText("Session interrupted", 30_000);
        const interrupted = await captureScrollback(gym);
        expect(interrupted).toContain("ABORTED_PARTIAL_RESPONSE");
        expect(interrupted).toContain("Session interrupted");

        submit(gym, "/configure");
        await gym.terminal.waitForText("Show full completed turns");
        for (let index = 0; index < 4; index += 1) gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Completed turn compaction disabled.");
        const restored = await captureScrollback(gym);
        expect(restored).toContain("COMPACTED_INTERMEDIATE_EXPLANATION");
        expect(restored).toContain("Edited note.txt");
        expect(restored).toContain("COMPACTED_FINAL_ANSWER");
        expect(restored).toContain("ABORTED_PARTIAL_RESPONSE");
        expect(restored).not.toContain("�");
    }, 90_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function rowContaining(rows: readonly string[], text: string): number {
    const row = rows.findIndex((candidate) => candidate.includes(text));
    expect(row).toBeGreaterThanOrEqual(0);
    return row;
}
