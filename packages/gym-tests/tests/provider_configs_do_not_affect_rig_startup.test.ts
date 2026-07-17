import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("provider configs do not affect Rig startup", () => {
    it("starts with unrelated Codex settings and ignores Codex MCP servers", async () => {
        const gym = await createGym({
            homeFiles: {
                ".codex/config.toml": [
                    'personality = "pragmatic"',
                    "",
                    "[mcp_servers.codex_only]",
                    'command = "missing-codex-mcp-server"',
                    "",
                ].join("\n"),
            },
        });
        running.add(gym);

        const ready = await gym.terminal.snapshot();
        expect(ready.text).toContain("Ask Rig to do anything");
        expect(ready.text).not.toContain("Codex only");
        expect(ready.text).not.toContain("MCP server blocked");
    }, 120_000);
});
