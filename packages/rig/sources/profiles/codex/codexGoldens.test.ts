import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createUnifiedPatch } from "../impl/createUnifiedPatch.js";
import { codexOpenaiGpt56LunaProfile } from "../codex-gpt-5-6-luna.js";
import { codexOpenaiGpt56SolProfile } from "../codex-gpt-5-6-sol.js";
import { codexOpenaiGpt56TerraProfile } from "../codex-gpt-5-6-terra.js";
import type { ModelProfile } from "../impl/types.js";
import { computeCodexProfilePrompt } from "./computeCodexProfilePrompt.js";
import { computeCodexProfileTools } from "./computeCodexProfileTools.js";
import { copyCodexProfileAssets } from "./copyCodexProfileAssets.js";
import { createCodexProfileSummary } from "./createCodexProfileSummary.js";
import {
    CODEX_PROFILE_ARTIFACTS,
    type CodexProfileCapture,
    type CodexProfileStem,
} from "./types.js";

const sourceCommit = "d4fcb2873bf23464cfacd804a31d46529db943b0";
const goldenHash = "cbefa6b0bede0e332d957fca70ccacf9f12f4c0ecdf81b819e5cbe1a3b16e265";
const goldenToolHashes: Readonly<Record<CodexProfileStem, string>> = {
    "codex-gpt-5-6-sol": "09a9ad8451241c329d98bb2ff0b85be3b035a081ffd37d3d2980402d742f023e",
    "codex-gpt-5-6-terra": "09a9ad8451241c329d98bb2ff0b85be3b035a081ffd37d3d2980402d742f023e",
    "codex-gpt-5-6-luna": "b5e6b9b174d3da16e5566f59eccd68d7f6b4feb60f3663f71358a1a81e16b585",
};
const computedHashes: Readonly<Record<CodexProfileStem, string>> = {
    "codex-gpt-5-6-sol": "482abd9194555f71cd342f4b571b86c2d3db3b2056da171a12283b2def9179ad",
    "codex-gpt-5-6-terra": "ec873e9934ee5046d690b95a09d881737b322eb91a433b41780a16967b6dbc1f",
    "codex-gpt-5-6-luna": "e6c93604385226ffd15aa7fefaab5ccc93334f6b435515c7978a741fff6b37ad",
};
const profiles: Readonly<Record<CodexProfileStem, ModelProfile>> = {
    "codex-gpt-5-6-sol": codexOpenaiGpt56SolProfile,
    "codex-gpt-5-6-terra": codexOpenaiGpt56TerraProfile,
    "codex-gpt-5-6-luna": codexOpenaiGpt56LunaProfile,
};

describe("Codex source profile artifacts", () => {
    it("keeps reserved collaboration schemas exactly official", async () => {
        for (const target of CODEX_PROFILE_ARTIFACTS.filter(
            (candidate) => candidate.multiAgentVersion === "v2",
        )) {
            const goldenTools = JSON.parse(
                await artifact(target.stem, ".tools.golden.json"),
            ) as Array<{ name: string; tools?: Array<{ name: string }> }>;
            const computedTools = JSON.parse(
                JSON.stringify(computeCodexProfileTools(target)),
            ) as Array<{ name: string; tools?: Array<{ name: string }> }>;
            const goldenMembers = goldenTools.find((tool) => tool.name === "collaboration")?.tools;
            const computedMembers = computedTools.find(
                (tool) => tool.name === "collaboration",
            )?.tools;
            const rigMembers = computedTools.find((tool) => tool.name === "rig")?.tools;

            expect(goldenMembers).toBeDefined();
            expect(goldenTools.some((tool) => tool.name === "rig")).toBe(false);
            expect(computedMembers).toBeDefined();
            expect(computedMembers).toEqual(goldenMembers);
            expect(rigMembers?.map((member) => member.name)).toEqual([
                "workflow",
                "wait_for_workflow",
                "workflow_status",
                "stop_workflow",
                "spawn_agent",
                "followup_task",
                "wait_agent",
                "list_agents",
                "interrupt_agent",
                "resume_agent",
            ]);
        }
    });

    it("keeps source captures, computed prompts, patches, summaries, and runtime profiles aligned", async () => {
        for (const target of CODEX_PROFILE_ARTIFACTS) {
            const capture = JSON.parse(
                await artifact(target.stem, ".capture.json"),
            ) as CodexProfileCapture;
            const goldenPrompt = await artifact(target.stem, ".golden.md");
            const computedPrompt = await artifact(target.stem, ".md");
            const promptPatch = await artifact(target.stem, ".patch");
            const goldenToolsJson = await artifact(target.stem, ".tools.golden.json");
            const computedToolsJson = await artifact(target.stem, ".tools.json");
            const toolsPatch = await artifact(target.stem, ".tools.patch");

            expect(capture.source).toMatchObject({
                repository: "https://github.com/openai/codex",
                branch: "main",
                commit: sourceCommit,
                path: "codex-rs/models-manager/models.json",
            });
            expect(capture.model).toMatchObject({
                slug: target.slug,
                baseInstructionsSha256: goldenHash,
                clientTools: target.clientTools,
            });
            expect(capture.tools).toMatchObject({
                client: "@openai/codex",
                version: "0.145.0",
                sourceDescription:
                    "Top-level and nested tool definitions from the first Responses request emitted by the installed official Codex CLI",
                captureMethod:
                    "Started the official Codex CLI against a local HTTP interception proxy and extracted the request tool definitions",
                sha256: goldenToolHashes[target.stem],
            });
            expect(createHash("sha256").update(goldenPrompt).digest("hex")).toBe(goldenHash);
            expect(createHash("sha256").update(goldenToolsJson).digest("hex")).toBe(
                goldenToolHashes[target.stem],
            );
            expect(computedPrompt).toBe(computeCodexProfilePrompt(goldenPrompt, target));
            expect(createHash("sha256").update(computedPrompt).digest("hex")).toBe(
                computedHashes[target.stem],
            );
            expect(promptPatch).toBe(
                await createUnifiedPatch({
                    before: goldenPrompt,
                    beforeName: `${target.stem}.golden.md`,
                    after: computedPrompt,
                    afterName: `${target.stem}.md`,
                }),
            );
            expect(computedToolsJson).toBe(
                `${JSON.stringify(computeCodexProfileTools(target), null, 2)}\n`,
            );
            expect(toolsPatch).toBe(
                await createUnifiedPatch({
                    before: goldenToolsJson,
                    beforeName: `${target.stem}.tools.golden.json`,
                    after: computedToolsJson,
                    afterName: `${target.stem}.tools.json`,
                }),
            );
            expect(await readFile(new URL(`../${target.stem}.md`, import.meta.url), "utf8")).toBe(
                createCodexProfileSummary({ target, capture, promptPatch, toolsPatch }),
            );
            expect(computedPrompt.startsWith(target.identity)).toBe(true);
            expect(computedPrompt).not.toContain("You are Codex, an agent based on GPT-5.");
            expect(computedPrompt).not.toContain("As Codex,");
            expect(computedPrompt).toContain("As Rig, you are an excellent communicator");

            const profile = profiles[target.stem];
            expect(profile.prompt.original?.text).toBe(computedPrompt);
            expect(profile.prompt.original?.provenance).toMatchObject({
                client: "@openai/codex",
                version: `main@${sourceCommit.slice(0, 12)}`,
                clientTools: target.clientTools,
            });
        }
    });

    it("copies the exact Codex artifact set into the built layout", async () => {
        const destination = await mkdtemp(join(tmpdir(), "rig-codex-assets-"));
        try {
            await copyCodexProfileAssets(destination);
            const copied = (await readdir(destination)).sort();
            expect(copied).toHaveLength(CODEX_PROFILE_ARTIFACTS.length * 7 + 5);
            for (const fileName of copied) {
                expect(await readFile(join(destination, fileName), "utf8")).toBe(
                    await readFile(new URL(`./${fileName}`, import.meta.url), "utf8"),
                );
            }
        } finally {
            await rm(destination, { force: true, recursive: true });
        }
    });
});

async function artifact(stem: string, suffix: string): Promise<string> {
    return readFile(new URL(`./${stem}${suffix}`, import.meta.url), "utf8");
}
