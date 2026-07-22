import { describe, expect, it } from "vitest";

import { modelProfiles } from "./modelProfiles.js";
import { BEDROCK_MODEL_ROUTES } from "../../providers/bedrock-model-routes.js";
import { createClaudeSdkProvider } from "../../providers/claude-sdk.js";
import { createCodexProvider } from "../../providers/codex.js";
import { createGrokProvider } from "../../providers/grok.js";
import { createKimiProvider } from "../../providers/kimi.js";
import type { ProfileProviderType } from "./types.js";
import { createJustBashToolHarness } from "../../tools/testing/createJustBashToolHarness.js";

describe("modelProfiles", () => {
    it("contains one unique profile for every curated provider and model pair", () => {
        expect(modelProfiles).toHaveLength(18);
        expect(new Set(modelProfiles.map((profile) => profile.id)).size).toBe(modelProfiles.length);
        expect(countByProviderType()).toEqual({
            bedrock: 8,
            claude: 3,
            codex: 3,
            grok: 3,
            kimi: 1,
        });

        for (const profile of modelProfiles) {
            expect(profile.id).toBe(`${profile.providerType}:${profile.model.id}`);
            expect(profile.model.id.startsWith(`${profile.vendor}/`)).toBe(true);
            expect(profile.tools.base.length).toBeGreaterThan(0);
            expect(profile.parameters).toMatchObject({
                contextWindow: profile.model.contextWindow,
                defaultThinkingLevel: profile.model.defaultThinkingLevel,
                thinkingLevels: profile.model.thinkingLevels,
            });
            const provenance = profile.prompt.original?.provenance;
            if (provenance !== undefined) {
                expect(provenance.client.length).toBeGreaterThan(0);
                expect(provenance.version.length).toBeGreaterThan(0);
                expect(provenance.source.length).toBeGreaterThan(0);
                expect(provenance.captureMethod.length).toBeGreaterThan(0);
                expect(provenance.clientTools.length).toBeGreaterThan(0);
            }
        }
    });

    it("covers the exact model catalogs exposed by every native provider", () => {
        const harness = createJustBashToolHarness();
        const providers = [
            createCodexProvider({ apiKey: "test" }),
            createClaudeSdkProvider({
                agentContext: harness.context,
                pathToClaudeCodeExecutable: "/test/claude",
            }),
            createGrokProvider({ apiKey: "test" }),
            createKimiProvider({ apiKey: "test" }),
        ];

        for (const provider of providers) {
            expect(provider.profileType).toBeDefined();
            expect(new Set(provider.models.map((model) => model.id))).toEqual(
                new Set(
                    modelProfiles
                        .filter((profile) => profile.providerType === provider.profileType)
                        .map((profile) => profile.model.id),
                ),
            );
        }
    });

    it("covers every Bedrock route with its route-specific model parameters", () => {
        const bedrockProfiles = modelProfiles.filter(
            (profile) => profile.providerType === "bedrock",
        );

        expect(new Set(bedrockProfiles.map((profile) => profile.model.id))).toEqual(
            new Set(BEDROCK_MODEL_ROUTES.map((route) => route.model.id)),
        );
        for (const route of BEDROCK_MODEL_ROUTES) {
            const profile = bedrockProfiles.find(
                (candidate) => candidate.model.id === route.model.id,
            );
            expect(profile?.parameters.contextWindow).toBe(route.contextWindow);
        }
    });

    it("records the official Codex Bedrock prompt and direct Responses metadata", () => {
        const bedrockOpenai = modelProfiles.filter(
            (profile) => profile.providerType === "bedrock" && profile.vendor === "openai",
        );

        expect(bedrockOpenai).toHaveLength(3);
        for (const profile of bedrockOpenai) {
            expect(profile.parameters.referenceClient?.request).toMatchObject({
                applyPatchToolType: "freeform",
                defaultReasoningSummary: "none",
                defaultVerbosity: "low",
                multiAgentVersion: "v1",
                parallelToolCalls: true,
                supportsSearchTool: true,
                toolMode: null,
                useResponsesLite: false,
            });
            expect(profile.prompt.original?.text).toContain(
                "You are Codex, a coding agent based on GPT-5.",
            );
            expect(profile.prompt.original?.provenance).toMatchObject({
                client: "Codex CLI",
                version: "0.145.0",
            });
        }
    });

    it("records the exact Codex main source request matrix used for comparison", () => {
        const expected = {
            "openai/gpt-5.6-luna": [
                true,
                "code_mode_only",
                "v1",
                ["low", "medium", "high", "xhigh", "max"],
            ],
            "openai/gpt-5.6-sol": [
                true,
                "code_mode_only",
                "v2",
                ["low", "medium", "high", "xhigh", "max", "ultra"],
            ],
            "openai/gpt-5.6-terra": [
                true,
                "code_mode_only",
                "v2",
                ["low", "medium", "high", "xhigh", "max", "ultra"],
            ],
        } as const;

        for (const profile of modelProfiles.filter((item) => item.providerType === "codex")) {
            const reference = profile.parameters.referenceClient!;
            expect([
                reference.request.useResponsesLite,
                reference.request.toolMode,
                reference.request.multiAgentVersion,
                reference.thinkingLevels,
            ]).toEqual(expected[profile.model.id as keyof typeof expected]);
        }

        const luna = modelProfiles.find((profile) => profile.id === "codex:openai/gpt-5.6-luna")!;
        expect(luna.prompt.original?.provenance.clientTools).toEqual([
            "exec",
            "wait",
            "request_user_input",
        ]);
        expect(luna.prompt.appends.map((append) => append.id)).not.toContain(
            "codex-ultra-multi-agent",
        );
    });

    it("records Claude Code 2.1.201 full-prompt and Agent SDK tool provenance", () => {
        const claude = modelProfiles.filter((profile) => profile.providerType === "claude");

        expect(claude.map((profile) => profile.model.id)).toEqual([
            "anthropic/fable-5",
            "anthropic/opus-4-8",
            "anthropic/sonnet-5",
        ]);
        for (const profile of claude) {
            expect(profile.parameters.referenceClient).toBeUndefined();
            expect(profile.prompt.original?.text).toContain(
                "You are an interactive agent that helps users with software engineering tasks.",
            );
            expect(profile.prompt.original?.provenance.clientTools).toContain("TaskCreate");
            expect(profile.prompt.original?.provenance.clientTools).not.toContain("TodoWrite");
        }
    });
});

function countByProviderType(): Record<ProfileProviderType, number> {
    return modelProfiles.reduce<Record<ProfileProviderType, number>>(
        (counts, profile) => ({
            ...counts,
            [profile.providerType]: counts[profile.providerType] + 1,
        }),
        { bedrock: 0, claude: 0, codex: 0, grok: 0, kimi: 0 },
    );
}
