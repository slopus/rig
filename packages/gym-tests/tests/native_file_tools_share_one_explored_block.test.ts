import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("native file tool rendering", () => {
    it("groups parallel list, search, and read tools into one Explored block", async () => {
        const gym = await createGym({
            environment: { ANTHROPIC_API_KEY: "claude-test-key" },
            files: { "src/example.ts": "export const needle = 42;\n" },
            inference: [
                {
                    content: [
                        {
                            arguments: { path: "/workspace/src", pattern: "**/*.ts" },
                            id: "list-source",
                            name: "Glob",
                            type: "toolCall",
                        },
                        {
                            arguments: { path: "/workspace/src", pattern: "needle" },
                            id: "search-source",
                            name: "Grep",
                            type: "toolCall",
                        },
                        {
                            arguments: { file_path: "/workspace/src/example.ts" },
                            id: "read-source",
                            name: "Read",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Native inspection complete.", type: "text" }] },
            ],
            modelId: "anthropic/sonnet-5",
            providerId: "claude",
            providerOverrides: ["claude"],
            rows: 40,
        });
        running.add(gym);

        gym.terminal.type("Inspect the source tree with file tools.");
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitForText("Native inspection complete.", 30_000);
        expect(completed.text.match(/• Explored/gu)).toHaveLength(1);
        expect(completed.text).toContain("List **/*.ts in src");
        expect(completed.text).toContain("Search needle in src");
        expect(completed.text).toContain("Read example.ts");
        expect(completed.text).not.toContain("Found files for");
        expect(completed.text).not.toContain("export const needle = 42");
    });
});
