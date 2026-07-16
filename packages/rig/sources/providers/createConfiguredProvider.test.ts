import { describe, expect, it } from "vitest";

import { createNodeAgentContext } from "../agent/context/createNodeAgentContext.js";
import type { ConfigProvider } from "../config/types.js";
import { NativeProxessManager } from "../processes/NativeProxessManager.js";
import { createConfiguredProvider } from "./createConfiguredProvider.js";
import { modelAnthropicFable5, modelOpenaiGpt56Sol, modelXaiGrokBuild } from "./models.js";

describe("createConfiguredProvider", () => {
    it.each([
        {
            config: {
                enabled: true,
                includeModels: [modelOpenaiGpt56Sol.id],
                type: "codex",
            } satisfies ConfigProvider,
            id: "work_codex",
            profile: "codex",
        },
        {
            config: {
                enabled: true,
                includeModels: [modelAnthropicFable5.id],
                type: "claude",
            } satisfies ConfigProvider,
            id: "work_claude",
            profile: "claude",
        },
        {
            config: {
                enabled: true,
                includeModels: [modelXaiGrokBuild.id],
                type: "grok",
            } satisfies ConfigProvider,
            id: "work_grok",
            profile: "grok",
        },
        {
            config: {
                enabled: true,
                includeModels: [modelOpenaiGpt56Sol.id],
                type: "bedrock",
            } satisfies ConfigProvider,
            id: "work_bedrock",
            profile: "codex",
        },
    ])("constructs and filters the $config.type provider", ({ config, id, profile }) => {
        const result = createConfiguredProvider({
            agentContext: context(),
            config,
            env: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
                AWS_REGION: "us-east-1",
            },
            id,
            sessionId: "agent-session",
        });

        expect(result.status).toBe("available");
        if (result.status !== "available") return;
        expect(result.provider.id).toBe(id);
        expect(result.provider.models).toHaveLength(1);
        expect(result.provider.toolProfile(result.provider.models[0]!)).toBe(profile);
    });

    it("reports the configured Bedrock credential boundary to callers", () => {
        const result = createConfiguredProvider({
            agentContext: context(),
            config: {
                bearerTokenEnvVar: "WORK_BEDROCK_TOKEN",
                enabled: true,
                type: "bedrock",
            },
            env: {},
            id: "work_bedrock",
        });

        expect(result).toEqual({
            status: "missing_credential",
            variable: "WORK_BEDROCK_TOKEN",
        });
    });
});

function context() {
    return createNodeAgentContext({
        cwd: "/tmp/rig-configured-provider-test",
        processManager: new NativeProxessManager(),
    });
}
