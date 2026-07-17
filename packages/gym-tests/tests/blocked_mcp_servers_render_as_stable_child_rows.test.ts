import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const BLOCKED_REASON =
    "MCP servers are available in Auto or Full access because they can act outside Rig's sandbox.";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("blocked MCP servers render as stable child rows", () => {
    it("keeps two real blocked servers under one immutable parent at wide and narrow widths", async () => {
        const gym = await createGym({
            cols: 120,
            homeFiles: {
                ".rig/config.toml": [
                    "[mcp_servers.openai_developer_docs]",
                    'command = "must-not-start"',
                    "",
                    "[mcp_servers.posthog]",
                    'command = "must-not-start"',
                    "",
                ].join("\n"),
            },
            inference: [{ content: [{ text: "BLOCKED_MCP_NOTICE_COMPLETE", type: "text" }] }],
            permissionMode: "read_only",
            rows: 24,
        });
        running.add(gym);

        gym.terminal.type("Check the configured MCP servers.");
        gym.terminal.press("enter");
        const wide = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.rows.includes("• MCP servers blocked") &&
                snapshot.rows.includes(`  └ OpenAI Developer Docs — ${BLOCKED_REASON}`) &&
                snapshot.rows.includes(`    PostHog — ${BLOCKED_REASON}`) &&
                snapshot.text.includes("BLOCKED_MCP_NOTICE_COMPLETE") &&
                snapshot.scroll.atBottom,
            "two blocked MCP child rows in the wide transcript",
            30_000,
        );
        expect(wide.rows.filter((row) => row === "• MCP servers blocked")).toHaveLength(1);
        expect(wide.rows.filter((row) => row.includes("└"))).toHaveLength(1);
        expect(wide.text).not.toMatch(/[│├↳]/u);
        await writeProof(gym, "blocked-mcp-wide.png");

        gym.terminal.resize(52, 24);
        const narrow = await gym.terminal.waitUntil(
            (snapshot) => {
                const parent = snapshot.rows.indexOf("• MCP servers blocked");
                return (
                    parent >= 0 &&
                    snapshot.rows
                        .slice(parent, parent + 7)
                        .join("\n")
                        .includes("OpenAI Developer Docs") &&
                    snapshot.rows
                        .slice(parent, parent + 7)
                        .join("\n")
                        .includes("PostHog") &&
                    snapshot.text.includes("BLOCKED_MCP_NOTICE_COMPLETE") &&
                    snapshot.scroll.atBottom
                );
            },
            "the same blocked MCP notice after narrowing",
            30_000,
        );
        const parent = narrow.rows.indexOf("• MCP servers blocked");
        expect(narrow.rows.slice(parent, parent + 6)).toEqual([
            "• MCP servers blocked",
            "  └ OpenAI Developer Docs — MCP servers are",
            "    available in Auto or Full access because they",
            "    can act outside Rig's sandbox.",
            "    PostHog — MCP servers are available in Auto or",
            "    Full access because they can act outside Rig's",
        ]);
        expect(narrow.rows[parent + 6]).toBe("    sandbox.");
        expect(narrow.rows.filter((row) => row === "• MCP servers blocked")).toHaveLength(1);
        expect(narrow.rows.filter((row) => row.includes("└"))).toHaveLength(1);
        expect(narrow.text).not.toMatch(/[│├↳]/u);
        expect(narrow.rows.every((row) => row.length <= 52)).toBe(true);
        await writeProof(gym, "blocked-mcp-narrow.png");
    });
});

async function writeProof(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}
