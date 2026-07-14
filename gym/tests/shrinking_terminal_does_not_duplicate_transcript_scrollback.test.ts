import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "../../packages/gym/sources/index.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("shrinking terminal does not duplicate transcript scrollback", () => {
    it("shrinks from twenty rows to six with one copy of prior output and remains usable", async () => {
        const response = Array.from(
            { length: 30 },
            (_, index) => `SHRINK MARKER ${String(index).padStart(2, "0")}`,
        ).join("\n");
        const gym = await createGym({
            cols: 60,
            inference: [
                { content: [{ text: response, type: "text" }] },
                {
                    content: [
                        {
                            arguments: {
                                cmd: "printf 'usable after resize\\n' > resize-ok.txt",
                            },
                            id: "resize-tool",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "RESIZE_FOLLOW_UP_COMPLETE", type: "text" }] },
            ],
            rows: 20,
        });
        running.add(gym);

        gym.terminal.type("seed shrink history");
        gym.terminal.press("enter");
        const beforeResize = await gym.terminal.waitForText("SHRINK MARKER 29", 30_000);
        expect(beforeResize.scroll.atBottom).toBe(true);

        gym.terminal.resize(60, 6);
        gym.terminal.type("prove the resized terminal remains usable");
        gym.terminal.press("enter");
        await gym.terminal.waitUntil(
            (snapshot) =>
                agentRequestCount(gym) === 3 &&
                snapshot.text.includes("Ask Rig to do anything") &&
                !snapshot.text.includes("esc to interrupt"),
            "the resized follow-up to finish and return to the idle composer",
            30_000,
        );
        await expect(gym.readFile("resize-ok.txt")).resolves.toBe("usable after resize\n");

        const scrollbackRows = await collectScrollbackRows(gym);
        expect.soft(countExactRow(scrollbackRows, "› seed shrink history")).toBe(1);
        expect.soft(countExactRow(scrollbackRows, "• SHRINK MARKER 00")).toBe(1);
        expect.soft(countExactRow(scrollbackRows, "SHRINK MARKER 29")).toBe(1);

        gym.terminal.scrollToBottom();
        const bottom = await gym.terminal.snapshot();
        expect(bottom.rows).toHaveLength(6);
        expect(bottom.scroll).toMatchObject({ atBottom: true, visibleRows: 6 });
        expect(bottom.text).toContain("Ask Rig to do anything");
        expect(bottom.text).toContain("gym off · /workspace");
        expect(bottom.text).not.toContain("�");
    }, 120_000);
});

function agentRequestCount(gym: Gym): number {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    ).length;
}

async function collectScrollbackRows(gym: Gym): Promise<string[]> {
    gym.terminal.scrollToTop();
    let snapshot = await gym.terminal.snapshot();
    const rows: string[] = [];

    for (;;) {
        if (snapshot.scroll.atBottom) {
            rows.push(...snapshot.rows);
            return rows;
        }

        rows.push(snapshot.rows[0] ?? "");
        const previousOffset = snapshot.scroll.offset;
        gym.terminal.scrollBy(1);
        snapshot = await gym.terminal.snapshot();
        if (snapshot.scroll.offset === previousOffset) {
            throw new Error(`Scrollback stopped advancing at offset ${previousOffset}.`);
        }
    }
}

function countExactRow(rows: readonly string[], value: string): number {
    return rows.filter((row) => row.trim() === value).length;
}
