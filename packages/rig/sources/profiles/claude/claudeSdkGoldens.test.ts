import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

import { agentTool } from "../../tools/Agent.js";
import { claudeCodeTools, claudeCollaborationTools } from "../../tools/claude/index.js";
import { modelProfiles } from "../impl/modelProfiles.js";
import { computeClaudeProfilePrompt } from "./computeClaudeProfilePrompt.js";
import { computeClaudeProfileTools } from "./computeClaudeProfileTools.js";
import { createClaudeProfileSummary } from "./createClaudeProfileSummary.js";
import { createUnifiedPatch } from "../impl/createUnifiedPatch.js";
import type { ClaudeSdkGolden } from "./capture/types.js";
import { CLAUDE_PROFILE_ARTIFACTS, type ClaudeToolDefinition } from "./types.js";
import { copyClaudeProfileAssets } from "./copyClaudeProfileAssets.js";

const expectedCaptureHashes: Readonly<Record<string, string>> = {
    "claude-fable-5": "536f16f2939501f9a055c30dfdbde34429f163c4497ca1022fcebdc300df955b",
    "claude-opus-4-8": "3a9ce28c3b0a9058fafe9760f0eaa08d2c3148a573c1d8bcc4d3f3a19dfd4e4d",
    "claude-sonnet-5": "8d474b1e2706aaf1b948eae7f6b647faa6780d865d87b35227eed08b6f43c17f",
};

const rigTools = [agentTool, ...claudeCodeTools, ...claudeCollaborationTools];
const baseToolNames: ReadonlySet<string> = new Set(claudeCodeTools.map((tool) => tool.name));
const collaborationToolNames: ReadonlySet<string> = new Set([
    agentTool.name,
    ...claudeCollaborationTools.map((tool) => tool.name),
]);

describe("Claude SDK profile artifacts", () => {
    it("keeps captures, computed prompts, tool definitions, patches, and runtime profiles aligned", async () => {
        for (const target of CLAUDE_PROFILE_ARTIFACTS) {
            const capture = JSON.parse(
                await artifact(target.stem, ".capture.json"),
            ) as ClaudeSdkGolden & {
                system: readonly { text?: string }[];
                tools: readonly ClaudeToolDefinition[];
            };
            const goldenPrompt = await artifact(target.stem, ".golden.md");
            const computedPrompt = await artifact(target.stem, ".md");
            const promptPatch = await artifact(target.stem, ".patch");
            const goldenToolsJson = await artifact(target.stem, ".tools.golden.json");
            const computedToolsJson = await artifact(target.stem, ".tools.json");
            const toolsPatch = await artifact(target.stem, ".tools.patch");
            const goldenTools = JSON.parse(goldenToolsJson) as readonly ClaudeToolDefinition[];
            const computedTools = JSON.parse(computedToolsJson) as readonly ClaudeToolDefinition[];

            expect(capture.system).toHaveLength(3);
            expect(capture.system[2]?.text).toBe(goldenPrompt);
            expect(capture.tools).toEqual(goldenTools);
            expect(computedPrompt).toBe(computeClaudeProfilePrompt(goldenPrompt, target));
            expect(computedTools).toEqual(computeClaudeProfileTools(goldenTools, rigTools));
            expect(promptPatch).toBe(
                await createUnifiedPatch({
                    before: goldenPrompt,
                    beforeName: `${target.stem}.golden.md`,
                    after: computedPrompt,
                    afterName: `${target.stem}.md`,
                }),
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
                createClaudeProfileSummary({ target, golden: capture, promptPatch, toolsPatch }),
            );

            expect(computedPrompt.startsWith(target.identity)).toBe(true);
            for (const unsupported of [
                "# Memory",
                "# auto memory",
                "Claude Code is available as a CLI",
                "Fast mode for Claude Code",
                "subagent_type=Explore",
                "/help: Get help with using Claude Code",
            ]) {
                expect(computedPrompt).not.toContain(unsupported);
            }
            if (target.stem === "claude-sonnet-5") {
                expect(computedPrompt).toContain(
                    "Tool results and user messages may include <system-reminder> or other tags.",
                );
                expect(computedPrompt).toContain("Users may configure 'hooks'");
            } else {
                expect(computedPrompt).toContain(
                    "`<system-reminder>` tags in messages and tool results are injected by the harness, not the user. Hooks may intercept tool calls; treat hook output as user feedback.",
                );
            }

            const profile = modelProfiles.find(
                (candidate) =>
                    candidate.providerType === "claude" &&
                    candidate.parameters.wireModelId === target.model,
            );
            expect(profile?.prompt.original?.text).toBe(computedPrompt);
            if (profile === undefined) throw new Error(`Missing profile for '${target.model}'.`);
            expect(profile.tools.base.map((tool) => tool.name)).toEqual(
                computedTools.map((tool) => tool.name).filter((name) => baseToolNames.has(name)),
            );
            expect(profile.tools.collaboration.map((tool) => tool.name)).toEqual(
                computedTools
                    .map((tool) => tool.name)
                    .filter((name) => collaborationToolNames.has(name)),
            );
            const definitionsByName = new Map(computedTools.map((tool) => [tool.name, tool]));
            for (const tool of [...profile.tools.base, ...profile.tools.collaboration]) {
                const definition = definitionsByName.get(tool.name);
                expect(definition, tool.name).toBeDefined();
                expect(tool.description, tool.name).toBe(definition?.description);
                expect(JSON.parse(JSON.stringify(tool.arguments)), tool.name).toEqual(
                    definition?.input_schema,
                );
                const validArguments = validValueForSchema(tool.arguments);
                expect(() => Value.Check(tool.arguments, validArguments), tool.name).not.toThrow();
                expect(Value.Check(tool.arguments, validArguments), tool.name).toBe(true);
            }
            expect(
                Value.Check(
                    profile.tools.base.find((tool) => tool.name === "TaskCreate")!.arguments,
                    {
                        subject: "Track profile work",
                        description: "Verify the generated Claude profile.",
                        metadata: { issue: "RIG-42", priority: 2 },
                    },
                ),
            ).toBe(true);
            expect(
                Value.Check(
                    profile.tools.base.find((tool) => tool.name === "TaskUpdate")!.arguments,
                    { taskId: "1", metadata: { issue: null } },
                ),
            ).toBe(true);

            expect(
                createHash("sha256")
                    .update(
                        JSON.stringify({
                            system: capture.system,
                            tools: capture.tools,
                            wireModel: capture.wireModel,
                        }),
                    )
                    .digest("hex"),
            ).toBe(expectedCaptureHashes[target.stem]);
        }
    });

    it("matches the installed Claude SDK source versions", async () => {
        const require = createRequire(import.meta.url);
        const sdkEntry = require.resolve("@anthropic-ai/claude-agent-sdk");
        const packageJson = JSON.parse(
            await readFile(join(dirname(sdkEntry), "package.json"), "utf8"),
        ) as { claudeCodeVersion: string; version: string };
        const manifest = JSON.parse(
            await readFile(join(dirname(sdkEntry), "manifest.json"), "utf8"),
        ) as { commit: string };

        for (const target of CLAUDE_PROFILE_ARTIFACTS) {
            const capture = JSON.parse(await artifact(target.stem, ".capture.json")) as {
                source: { claudeCodeVersion: string; commit: string; sdkVersion: string };
            };
            expect(capture.source).toMatchObject({
                claudeCodeVersion: packageJson.claudeCodeVersion,
                commit: manifest.commit,
                sdkVersion: packageJson.version,
            });
        }
    });

    it("copies the exact adjacent artifact set into the built layout", async () => {
        const destination = await mkdtemp(join(tmpdir(), "rig-claude-assets-"));
        try {
            await copyClaudeProfileAssets(destination);
            const copied = (await readdir(destination)).sort();
            expect(copied).toHaveLength(CLAUDE_PROFILE_ARTIFACTS.length * 7);
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

function validValueForSchema(schema: TSchema): unknown {
    const candidate = schema as TSchema & {
        anyOf?: TSchema[];
        const?: unknown;
        enum?: unknown[];
        exclusiveMinimum?: number;
        format?: string;
        minLength?: number;
        minItems?: number;
        minimum?: number;
        items?: TSchema;
        properties?: Record<string, TSchema>;
        required?: string[];
        type?: string;
    };
    if (Object.prototype.hasOwnProperty.call(candidate, "const")) return candidate.const;
    if (candidate.enum !== undefined) return candidate.enum[0];
    if (candidate.anyOf !== undefined) return validValueForSchema(candidate.anyOf[0]!);
    switch (candidate.type) {
        case "array":
            return Array.from({ length: candidate.minItems ?? 0 }, () =>
                validValueForSchema(candidate.items ?? ({} as unknown as TSchema)),
            );
        case "boolean":
            return false;
        case "integer":
        case "number":
            return candidate.minimum ?? (candidate.exclusiveMinimum ?? -1) + 1;
        case "object":
            return Object.fromEntries(
                (candidate.required ?? []).map((name) => [
                    name,
                    validValueForSchema(candidate.properties?.[name] ?? ({} as unknown as TSchema)),
                ]),
            );
        case "string":
            return candidate.format === "uri"
                ? "https://example.com"
                : "x".repeat(Math.max(1, candidate.minLength ?? 0));
        default:
            return null;
    }
}
