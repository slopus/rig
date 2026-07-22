import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { computeProfileSystemPrompt } from "./computeProfileSystemPrompt.js";
import { codexOpenaiGpt56SolProfile } from "../codex-gpt-5-6-sol.js";
import { codexOpenaiGpt56TerraProfile } from "../codex-gpt-5-6-terra.js";
import { codexOpenaiGpt56LunaProfile } from "../codex-gpt-5-6-luna.js";
import { claudeAnthropicOpus48Profile } from "../claude-opus-4-8.js";
import { claudeAnthropicFable5Profile } from "../claude-fable-5.js";
import { claudeAnthropicSonnet5Profile } from "../claude-sonnet-5.js";
import { CODEX_ULTRA_INSTRUCTIONS } from "../codex/appends/codexUltraInstructions.js";
import type { ProfilePromptAppendContext } from "./types.js";

describe("computeProfileSystemPrompt", () => {
    it("preserves the persisted Rig-computed Codex prompt bodies", () => {
        const captures = [
            [
                codexOpenaiGpt56SolProfile,
                "482abd9194555f71cd342f4b571b86c2d3db3b2056da171a12283b2def9179ad",
            ],
            [
                codexOpenaiGpt56TerraProfile,
                "ec873e9934ee5046d690b95a09d881737b322eb91a433b41780a16967b6dbc1f",
            ],
            [
                codexOpenaiGpt56LunaProfile,
                "e6c93604385226ffd15aa7fefaab5ccc93334f6b435515c7978a741fff6b37ad",
            ],
        ] as const;

        for (const [profile, expectedHash] of captures) {
            const text = profile.prompt.original?.text;
            expect(text).toMatch(/^You are Rig, a coding agent powered by GPT-5\.6/u);
            expect(createHash("sha256").update(text!).digest("hex")).toBe(expectedHash);
        }
    });

    it("preserves the persisted Rig-computed Claude Code 2.1.201 prompt bodies", () => {
        const captures = [
            [
                claudeAnthropicFable5Profile,
                "d0e57f732f9ebac5b3bf7feeb009438dfb330dd12ca81f21f0d6bd1d7a041d6d",
            ],
            [
                claudeAnthropicOpus48Profile,
                "cdca3682748fe9f86614f2744ed6f5d2c86a1b7a6f95d20b0942f26d2a2ed3d2",
            ],
            [
                claudeAnthropicSonnet5Profile,
                "be4966f1b89410666319aae6b69f00d300ed559e77e621d2f49a68d799fb6ad7",
            ],
        ] as const;

        for (const [profile, expectedHash] of captures) {
            const text = profile.prompt.original?.text;
            expect(text).toContain(
                "You are an interactive agent that helps users with software engineering tasks.",
            );
            expect(createHash("sha256").update(text!).digest("hex")).toBe(expectedHash);
        }
    });

    it("removes unsupported Claude Code memory and product instructions", () => {
        const prompt = computeProfileSystemPrompt(claudeAnthropicSonnet5Profile, {
            claudeConfigDirectory: "/test/config",
            cwd: "/test/repository",
            isGitRepository: true,
            modelId: claudeAnthropicSonnet5Profile.model.id,
            osVersion: "Darwin 25.5.0",
            platform: "darwin",
            projectRoot: "/test/repository",
            providerId: "claude",
            shell: "/bin/zsh",
        });

        expect(prompt).toMatch(/^You are Rig, a coding agent powered by Claude Sonnet 5\./u);
        expect(prompt).not.toContain("# auto memory");
        expect(prompt).not.toContain("Claude Code is available as a CLI");
        expect(prompt).not.toContain("subagent_type=Explore");
    });

    it("applies patches before ordered appends to produce the computed prompt", () => {
        const profile = {
            ...codexOpenaiGpt56SolProfile,
            prompt: {
                original: {
                    ...codexOpenaiGpt56SolProfile.prompt.original!,
                    text: "Original prompt.",
                },
                patches: [
                    {
                        id: "replace-original",
                        description: "Test patch.",
                        find: "Original",
                        replace: "Patched",
                    },
                ],
                appends: [
                    {
                        id: "first",
                        description: "First append.",
                        render: () => "First append.",
                    },
                    {
                        id: "second",
                        description: "Second append.",
                        render: ({ modelId, providerId }: ProfilePromptAppendContext) =>
                            `${providerId}/${modelId}`,
                    },
                ],
            },
        };

        expect(
            computeProfileSystemPrompt(profile, {
                modelId: "openai/test",
                providerId: "work_codex",
            }),
        ).toBe("Patched prompt.\n\nFirst append.\n\nwork_codex/openai/test");
    });

    it("computes the Codex Ultra append in the profile recipe", () => {
        const context = {
            modelId: codexOpenaiGpt56SolProfile.model.id,
            providerId: "codex",
        };

        expect(
            computeProfileSystemPrompt(codexOpenaiGpt56SolProfile, {
                ...context,
                effort: "ultra",
            }),
        ).toContain(CODEX_ULTRA_INSTRUCTIONS);
        expect(computeProfileSystemPrompt(codexOpenaiGpt56SolProfile, context)).not.toContain(
            CODEX_ULTRA_INSTRUCTIONS,
        );
        expect(
            computeProfileSystemPrompt(
                codexOpenaiGpt56SolProfile,
                { ...context, effort: "ultra" },
                { originalOverride: "External prompt." },
            ),
        ).toBe(`External prompt.\n\n${CODEX_ULTRA_INSTRUCTIONS}`);
    });

    it("fails closed when a declared prompt patch no longer matches", () => {
        const profile = {
            ...codexOpenaiGpt56SolProfile,
            prompt: {
                ...codexOpenaiGpt56SolProfile.prompt,
                patches: [
                    {
                        id: "stale-patch",
                        description: "A stale patch.",
                        find: "text that is not present",
                        replace: "replacement",
                    },
                ],
            },
        };

        expect(() =>
            computeProfileSystemPrompt(profile, {
                modelId: profile.model.id,
                providerId: "codex",
            }),
        ).toThrow("Prompt patch 'stale-patch' did not match");
    });
});
