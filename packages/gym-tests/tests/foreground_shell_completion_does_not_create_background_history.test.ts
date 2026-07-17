import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("foreground shell completion history", () => {
    it("renders the command once without a background-terminal completion row", async () => {
        const gym = await createGym({
            inference: [
                {
                    content: [
                        {
                            arguments: { cmd: "printf 'foreground-complete\\n'" },
                            id: "foreground-command",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Foreground work finished.", type: "text" }] },
            ],
        });
        running.add(gym);

        gym.terminal.type("Run a short foreground command.");
        gym.terminal.press("enter");

        const snapshot = await gym.terminal.waitForText("Foreground work finished.");
        expect(snapshot.rows.filter((row) => row.includes("• Ran "))).toEqual([
            expect.stringContaining("• Ran printf 'foreground-complete\\n'"),
        ]);
        expect(snapshot.text).toContain("└ foreground-complete");
        expect(snapshot.text).not.toContain("Background terminal completed");
        expect(snapshot.text).not.toContain("Background terminal closed");
    }, 120_000);
});
