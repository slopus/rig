import { describe, expect, it } from "vitest";

import { createConfiguredClaudeEnvironment } from "./createConfiguredClaudeEnvironment.js";

describe("createConfiguredClaudeEnvironment", () => {
    it("scopes a configured OAuth token to the named Claude provider", () => {
        expect(
            createConfiguredClaudeEnvironment(
                {
                    configDir: "/tmp/claude-work",
                    enabled: true,
                    oauthToken: "claude-work-token",
                    type: "claude",
                },
                {
                    ANTHROPIC_API_KEY: "default-api-key",
                    ANTHROPIC_AUTH_TOKEN: "default-auth-token",
                    CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: "3",
                    CLAUDE_CODE_OAUTH_TOKEN: "default-claude-token",
                    CLAUDE_CODE_USE_BEDROCK: "1",
                    CLAUDE_CODE_USE_FOUNDRY: "1",
                    CLAUDE_CODE_USE_VERTEX: "1",
                    RIG_CLAUDE_CODE_EXECUTABLE: "/tmp/claude",
                },
            ),
        ).toEqual({
            CLAUDE_CODE_OAUTH_TOKEN: "claude-work-token",
            CLAUDE_CONFIG_DIR: "/tmp/claude-work",
            RIG_CLAUDE_CODE_EXECUTABLE: "/tmp/claude",
        });
    });
});
