import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("completed work timer ordering", () => {
    it("replaces the live Working row below the final response after multiple tool cycles", async () => {
        const gym = await createGym({
            cols: 100,
            inference: [
                {
                    content: [
                        {
                            arguments: { cmd: "printf 'FIRST_TOOL_RESULT\\n'" },
                            id: "first-tool",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [
                        {
                            arguments: { cmd: "printf 'SECOND_TOOL_RESULT\\n'" },
                            id: "second-tool",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [{ text: "FINAL_ASSISTANT_RESPONSE", type: "text" }],
                    delayMs: 61_000,
                },
            ],
            rows: 30,
        });
        running.add(gym);

        submit(gym, "Run both tools and summarize the result.");

        const live = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("SECOND_TOOL_RESULT") &&
                snapshot.text.includes("Working") &&
                snapshot.text.includes("esc to interrupt"),
            "the live Working timer after both tool cycles",
            30_000,
        );
        expect(live.text.match(/Working/gu)).toHaveLength(1);
        expect(live.text).not.toContain("Worked for");
        await writeProof(gym, "live-working.png");

        const settled = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("FINAL_ASSISTANT_RESPONSE") &&
                snapshot.text.includes("Worked for") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the final response followed by its completed work timer",
            90_000,
        );
        const finalResponseRow = rowContaining(settled.rows, "FINAL_ASSISTANT_RESPONSE");
        const workedRow = rowContaining(settled.rows, "Worked for");
        const composerRow = rowContaining(settled.rows, "Ask Rig to do anything");
        expect(finalResponseRow).toBeLessThan(workedRow);
        expect(workedRow).toBeLessThan(composerRow);
        expect(settled.text.match(/Worked for/gu)).toHaveLength(1);
        expect(settled.text).not.toContain("esc to interrupt");
        await writeProof(gym, "settled-ordering.png");
    }, 120_000);
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

async function writeProof(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}
