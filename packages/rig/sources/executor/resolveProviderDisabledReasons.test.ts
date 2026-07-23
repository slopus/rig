import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ConfigProviders } from "../config/types.js";
import { resolveProviderDisabledReasons } from "./resolveProviderDisabledReasons.js";

const GROK_OAUTH_SCOPE = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";
const tempDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        tempDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("resolveProviderDisabledReasons", () => {
    it("accepts a configured Claude Code OAuth token for a named account", async () => {
        const reasons = await resolveProviderDisabledReasons(
            {
                work_claude: {
                    enabled: true,
                    oauthToken: "claude-work-token",
                    type: "claude",
                },
            },
            {},
        );

        expect(reasons.has("work_claude")).toBe(false);
    });

    it("disables configured providers when their local authentication is absent", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-provider-auth-"));
        tempDirectories.push(root);
        const reasons = await resolveProviderDisabledReasons(providersFor(root), {
            ANTHROPIC_API_KEY: "   ",
            AWS_BEARER_TOKEN_BEDROCK: "   ",
            CLAUDE_CODE_OAUTH_TOKEN: "   ",
            XAI_API_KEY: "   ",
        });

        expect(Object.fromEntries(reasons)).toEqual({
            bedrock: "not_authenticated",
            claude: "not_authenticated",
            codex: "not_authenticated",
            grok: "not_authenticated",
            turned_off: "not_enabled",
        });
    });

    it("accepts credential presence without contacting provider servers", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-provider-auth-"));
        tempDirectories.push(root);
        await writeFile(
            join(root, "codex.json"),
            JSON.stringify({ tokens: { access_token: "codex-token" } }),
        );
        await writeFile(
            join(root, "grok.json"),
            JSON.stringify({ [GROK_OAUTH_SCOPE]: { key: "grok-token" } }),
        );

        const reasons = await resolveProviderDisabledReasons(providersFor(root), {
            ANTHROPIC_API_KEY: "anthropic-key",
            AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
        });

        expect(Object.fromEntries(reasons)).toEqual({ turned_off: "not_enabled" });
    });
});

function providersFor(root: string): ConfigProviders {
    return {
        bedrock: { enabled: true, type: "bedrock" },
        claude: { configDir: join(root, "claude"), enabled: true, type: "claude" },
        codex: { authFile: join(root, "codex.json"), enabled: true, type: "codex" },
        grok: { authFile: join(root, "grok.json"), enabled: true, type: "grok" },
        turned_off: { enabled: false, type: "grok" },
    };
}
