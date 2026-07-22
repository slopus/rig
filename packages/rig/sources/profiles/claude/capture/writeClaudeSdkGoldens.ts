import { readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { agentTool } from "../../../tools/Agent.js";
import { claudeCodeTools, claudeCollaborationTools } from "../../../tools/claude/index.js";
import { applyClaudeProfileToolDefinitions } from "../applyClaudeProfileToolDefinitions.js";
import { computeClaudeProfilePrompt } from "../computeClaudeProfilePrompt.js";
import { computeClaudeProfileTools } from "../computeClaudeProfileTools.js";
import { createClaudeProfileSummary } from "../createClaudeProfileSummary.js";
import { CLAUDE_PROFILE_ARTIFACTS, type ClaudeToolDefinition } from "../types.js";
import { captureClaudeSdkRequest } from "./captureClaudeSdkRequest.js";
import { createUnifiedPatch } from "../../impl/createUnifiedPatch.js";
import { describeFirstDifference } from "./describeFirstDifference.js";
import { extractClaudeSdkGolden } from "./extractClaudeSdkGolden.js";
import type { ClaudeSdkGolden } from "./types.js";

const rigTools = [agentTool, ...claudeCodeTools, ...claudeCollaborationTools];

export async function writeClaudeSdkGoldens(options: {
    check: boolean;
}): Promise<readonly string[]> {
    const require = createRequire(import.meta.url);
    const sdkEntry = require.resolve("@anthropic-ai/claude-agent-sdk");
    const packageJson = JSON.parse(
        await readFile(join(dirname(sdkEntry), "package.json"), "utf8"),
    ) as { claudeCodeVersion: string; version: string };
    const manifest = JSON.parse(
        await readFile(join(dirname(sdkEntry), "manifest.json"), "utf8"),
    ) as { commit: string };
    const platform = `${process.platform}-${process.arch}`;
    const outputDirectory = fileURLToPath(new URL("../", import.meta.url));
    const profileDirectory = dirname(outputDirectory);

    const written: string[] = [];
    for (const target of CLAUDE_PROFILE_ARTIFACTS) {
        const capture = await captureClaudeSdkRequest(target.model);
        const golden = extractClaudeSdkGolden({
            ...capture,
            claudeCodeVersion: packageJson.claudeCodeVersion,
            commit: manifest.commit,
            modelOption: target.model,
            platform,
            sdkVersion: packageJson.version,
        });
        await verifyDynamicProbes({
            golden,
            packageJson,
            manifest,
            model: target.model,
            platform,
            ...(capture.captureShell === undefined ? {} : { shell: capture.captureShell }),
        });

        const goldenPrompt = extractPromptBody(golden);
        const computedPrompt = computeClaudeProfilePrompt(goldenPrompt, target);
        const goldenTools = golden.tools as unknown as readonly ClaudeToolDefinition[];
        const computedTools = computeClaudeProfileTools(goldenTools, rigTools);
        // Validate that every persisted definition can hydrate the actual executable registry.
        applyClaudeProfileToolDefinitions(rigTools, computedTools);

        const captureJson = `${JSON.stringify(golden, null, 2)}\n`;
        const goldenToolsJson = `${JSON.stringify(goldenTools, null, 2)}\n`;
        const computedToolsJson = `${JSON.stringify(computedTools, null, 2)}\n`;
        const promptPatch = await createUnifiedPatch({
            before: goldenPrompt,
            beforeName: `${target.stem}.golden.md`,
            after: computedPrompt,
            afterName: `${target.stem}.md`,
        });
        const toolsPatch = await createUnifiedPatch({
            before: goldenToolsJson,
            beforeName: `${target.stem}.tools.golden.json`,
            after: computedToolsJson,
            afterName: `${target.stem}.tools.json`,
        });
        const artifacts = [
            [`${target.stem}.capture.json`, captureJson],
            [`${target.stem}.golden.md`, goldenPrompt],
            [`${target.stem}.md`, computedPrompt],
            [`${target.stem}.patch`, promptPatch],
            [`${target.stem}.tools.golden.json`, goldenToolsJson],
            [`${target.stem}.tools.json`, computedToolsJson],
            [`${target.stem}.tools.patch`, toolsPatch],
        ] as const;
        for (const [fileName, content] of artifacts) {
            const path = join(outputDirectory, fileName);
            await writeOrCheck(path, content, options.check);
            written.push(path);
        }
        const summaryPath = join(profileDirectory, `${target.stem}.md`);
        const summary = createClaudeProfileSummary({
            target,
            golden,
            promptPatch,
            toolsPatch,
        });
        await writeOrCheck(summaryPath, summary, options.check);
        written.push(summaryPath);
    }
    return written;
}

function extractPromptBody(golden: ClaudeSdkGolden): string {
    const blocks = Array.isArray(golden.system) ? golden.system : [golden.system];
    if (blocks.length !== 3) {
        throw new Error(
            `Claude SDK wrapper changed: expected 3 blocks, received ${blocks.length}.`,
        );
    }
    const body = blocks[2];
    if (
        typeof body !== "object" ||
        body === null ||
        !("type" in body) ||
        body.type !== "text" ||
        !("text" in body) ||
        typeof body.text !== "string"
    ) {
        throw new Error("Claude SDK third system block is no longer text.");
    }
    return body.text;
}

async function verifyDynamicProbes(options: {
    golden: ClaudeSdkGolden;
    packageJson: { claudeCodeVersion: string; version: string };
    manifest: { commit: string };
    model: string;
    platform: string;
    shell?: string;
}): Promise<void> {
    const alternateShell = options.shell?.includes("bash") ? "/bin/zsh" : "/bin/bash";
    const probes = await Promise.all([
        captureClaudeSdkRequest(options.model, { gitRepository: true, shell: alternateShell }),
        captureClaudeSdkRequest(options.model, { worktree: true }),
        captureClaudeSdkRequest(options.model, { longProjectPath: true }),
    ]);
    const normalizedRequest = normalizedGolden(options.golden);
    for (const probe of probes) {
        const normalizedProbe = normalizedGolden(
            extractClaudeSdkGolden({
                ...probe,
                claudeCodeVersion: options.packageJson.claudeCodeVersion,
                commit: options.manifest.commit,
                modelOption: options.model,
                platform: options.platform,
                sdkVersion: options.packageJson.version,
            }),
        );
        if (normalizedProbe !== normalizedRequest) {
            throw new Error(
                `Claude SDK model '${options.model}' contains an unrecognized dynamic section; ${describeFirstDifference(normalizedRequest, normalizedProbe)}`,
            );
        }
    }
}

function normalizedGolden(golden: ClaudeSdkGolden): string {
    return JSON.stringify({
        system: golden.system,
        tools: golden.tools,
        wireModel: golden.wireModel,
    });
}

async function writeOrCheck(path: string, content: string, check: boolean): Promise<void> {
    if (check) {
        const existing = await readFile(path, "utf8").catch(() => undefined);
        if (existing !== content) {
            throw new Error(
                `Claude SDK artifact is stale: ${path}; ${describeFirstDifference(existing ?? "", content)}`,
            );
        }
        return;
    }
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, path);
}
