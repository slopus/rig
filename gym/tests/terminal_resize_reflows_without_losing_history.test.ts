import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "../../packages/gym/sources/index.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("terminal resize reflows without losing history", () => {
    it("preserves one copy of the transcript through narrow and wide layouts", async () => {
        const response = [
            "REFLOW_HISTORY_BEGIN",
            ...Array.from(
                { length: 120 },
                (_, index) =>
                    `- Reflow line ${String(index).padStart(3, "0")} has enough text to wrap in a narrow terminal.`,
            ),
            "REFLOW_UNIQUE_MIDDLE_MARKER",
            ...Array.from(
                { length: 60 },
                (_, index) => `- Reflow tail ${String(index).padStart(3, "0")}`,
            ),
            "REFLOW_HISTORY_END",
        ].join("\n");
        const gym = await createGym({
            cols: 84,
            inference: [
                { content: [{ text: response, type: "text" }] },
                { content: [{ text: "REFLOW_FOLLOW_UP_ACCEPTED", type: "text" }] },
            ],
            rows: 20,
        });
        running.add(gym);
        const startupScroll = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Create a transcript that can be checked across resizes.");
        gym.terminal.press("enter");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("REFLOW_HISTORY_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "initial reflow transcript and idle composer",
            30_000,
        );

        gym.terminal.resize(44, 14);
        const narrow = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.rows.length === 14 &&
                snapshot.scroll.visibleRows === 14 &&
                snapshot.text.includes("REFLOW_HISTORY_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "healthy narrow layout at the bottom",
            30_000,
        );
        expect(narrow.scroll.totalRows).toBeGreaterThan(narrow.scroll.visibleRows);
        expect(narrow.scroll.offset + narrow.scroll.visibleRows).toBe(narrow.scroll.totalRows);
        expect(narrow.scroll.bottomDepartureCount).toBe(startupScroll.bottomDepartureCount);
        expect(narrow.scroll.topArrivalCount).toBe(startupScroll.topArrivalCount);
        expect(narrow.text).toContain("Gym Off • /workspace");
        expect(narrow.text).not.toContain("�");
        expect(narrow.cursor.x).toBeLessThan(44);
        expect(narrow.cursor.y).toBeLessThan(14);

        const narrowHistory = await captureScrollback(gym);
        expect(countOccurrences(narrowHistory.text, "REFLOW_HISTORY_BEGIN")).toBe(1);
        expect(countOccurrences(narrowHistory.text, "REFLOW_UNIQUE_MIDDLE_MARKER")).toBe(1);
        expect(countOccurrences(narrowHistory.text, "REFLOW_HISTORY_END")).toBe(1);

        const beforeWideResize = narrowHistory.bottom.scroll;
        gym.terminal.resize(112, 28);
        const wide = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.rows.length === 28 &&
                snapshot.scroll.visibleRows === 28 &&
                snapshot.text.includes("REFLOW_HISTORY_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "healthy wide layout at the bottom",
            30_000,
        );
        expect(wide.scroll.totalRows).toBeGreaterThan(wide.scroll.visibleRows);
        expect(wide.scroll.offset + wide.scroll.visibleRows).toBe(wide.scroll.totalRows);
        expect(wide.scroll.bottomDepartureCount).toBe(beforeWideResize.bottomDepartureCount);
        expect(wide.scroll.topArrivalCount).toBe(beforeWideResize.topArrivalCount);
        expect(wide.text).toContain("Gym Off • /workspace");
        expect(wide.text).not.toContain("�");
        expect(wide.cursor.x).toBeLessThan(112);
        expect(wide.cursor.y).toBeLessThan(28);

        const wideHistory = await captureScrollback(gym);
        expect(countOccurrences(wideHistory.text, "REFLOW_HISTORY_BEGIN")).toBe(1);
        expect(countOccurrences(wideHistory.text, "REFLOW_UNIQUE_MIDDLE_MARKER")).toBe(1);
        expect(countOccurrences(wideHistory.text, "REFLOW_HISTORY_END")).toBe(1);

        const beforeFollowUp = wideHistory.bottom.scroll;
        gym.terminal.type("Confirm input still works after both resizes.");
        gym.terminal.press("enter");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("REFLOW_FOLLOW_UP_ACCEPTED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up response after narrow and wide resizes",
            30_000,
        );
        expect(followUp.rows).toHaveLength(28);
        expect(followUp.scroll.visibleRows).toBe(28);
        expect(followUp.scroll.offset + followUp.scroll.visibleRows).toBe(
            followUp.scroll.totalRows,
        );
        expect(followUp.scroll.bottomDepartureCount).toBe(beforeFollowUp.bottomDepartureCount);
        expect(followUp.scroll.topArrivalCount).toBe(beforeFollowUp.topArrivalCount);
        expect(followUp.text).toContain("Gym Off • /workspace");
        expect(followUp.text).not.toContain("�");
        expect(followUp.cursor.x).toBeLessThan(112);
        expect(followUp.cursor.y).toBeLessThan(28);
    }, 120_000);
});

async function captureScrollback(
    gym: Gym,
): Promise<{ bottom: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>; text: string }> {
    gym.terminal.scrollToTop();
    let snapshot = await gym.terminal.snapshot();
    expect(snapshot.scroll.atTop).toBe(true);
    const rows = new Map<number, string>();

    for (;;) {
        snapshot.rows.forEach((row, index) => {
            rows.set(snapshot.scroll.offset + index, row);
        });
        if (snapshot.scroll.atBottom) break;

        const largestOffset = snapshot.scroll.totalRows - snapshot.scroll.visibleRows;
        const nextOffset = Math.min(
            snapshot.scroll.offset + snapshot.scroll.visibleRows,
            largestOffset,
        );
        const delta = nextOffset - snapshot.scroll.offset;
        expect(delta).toBeGreaterThan(0);
        gym.terminal.scrollBy(delta);
        const next = await gym.terminal.snapshot();
        expect(next.scroll.offset).toBeGreaterThan(snapshot.scroll.offset);
        snapshot = next;
    }

    gym.terminal.scrollToBottom();
    const bottom = await gym.terminal.snapshot();
    expect(bottom.scroll.atBottom).toBe(true);
    bottom.rows.forEach((row, index) => {
        rows.set(bottom.scroll.offset + index, row);
    });
    return {
        bottom,
        text: [...rows.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, row]) => row)
            .join("\n"),
    };
}

function countOccurrences(text: string, search: string): number {
    return text.split(search).length - 1;
}
