import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createUnifiedPatch } from "../../impl/createUnifiedPatch.js";
import { computeCodexProfilePrompt } from "../computeCodexProfilePrompt.js";
import { createCodexProfileSummary } from "../createCodexProfileSummary.js";
import { computeCodexProfileTools } from "../computeCodexProfileTools.js";
import { CODEX_PROFILE_ARTIFACTS, type CodexProfileCapture } from "../types.js";

const execFileAsync = promisify(execFile);
const sourceRelativePath = "codex-rs/models-manager/models.json" as const;
const toolCaptureClient = "@openai/codex" as const;
const toolCaptureVersion = "0.144.6";
const toolCaptureSourceDescription =
    "Top-level and nested tool definitions from the first Responses request emitted by the installed official Codex CLI";
const toolCaptureMethod =
    "Started the official Codex CLI against a local HTTP interception proxy and extracted the request tool definitions";

interface CodexSourceModel {
    slug: string;
    base_instructions: string;
    model_messages?: {
        instructions_template?: string;
        instructions_variables?: {
            personality_default?: string;
            personality_friendly?: string;
            personality_pragmatic?: string;
        };
    };
    tool_mode?: string;
    multi_agent_version?: string;
}

export async function writeCodexGoldens(options: {
    check: boolean;
    sourceDirectory?: string;
}): Promise<readonly string[]> {
    const sourceDirectory =
        options.sourceDirectory ??
        process.env.RIG_CODEX_REFERENCE_SOURCE ??
        join(homedir(), "Developer", "coding-assistant-sources", "codex");
    const originRemote = await runGit(sourceDirectory, [
        "config",
        "--get",
        "remote.origin.url",
    ]).catch(() => "");
    if (
        ![
            "https://github.com/openai/codex",
            "https://github.com/openai/codex.git",
            "git@github.com:openai/codex.git",
            "ssh://git@github.com/openai/codex.git",
        ].includes(originRemote)
    ) {
        throw new Error(
            `Codex reference source must use the official OpenAI Codex origin; received '${originRemote}'.`,
        );
    }
    const branch = await runGit(sourceDirectory, ["symbolic-ref", "--short", "HEAD"]).catch(
        () => "",
    );
    if (branch !== "main") {
        throw new Error(
            `Codex reference source must have the main branch checked out; received '${branch || "detached HEAD"}'.`,
        );
    }
    const status = await runGit(sourceDirectory, ["status", "--short"]);
    if (status.length > 0) {
        throw new Error(`Codex reference source is dirty: ${sourceDirectory}`);
    }
    const [headCommit, originMainCommit] = await Promise.all([
        runGit(sourceDirectory, ["rev-parse", "HEAD"]),
        runGit(sourceDirectory, ["rev-parse", "refs/remotes/origin/main"]),
    ]);
    if (headCommit !== originMainCommit) {
        throw new Error(
            `Codex reference source HEAD ${headCommit} does not match origin/main ${originMainCommit}.`,
        );
    }
    const [commit, commitDate, ...subjectLines] = (
        await runGit(sourceDirectory, ["show", "-s", "--format=%H%n%cI%n%s", "HEAD"])
    ).split("\n");
    if (commit === undefined || commitDate === undefined || subjectLines.length === 0) {
        throw new Error("Unable to read Codex source revision metadata.");
    }
    const document = JSON.parse(
        await readFile(join(sourceDirectory, sourceRelativePath), "utf8"),
    ) as { models?: readonly CodexSourceModel[] };
    if (!Array.isArray(document.models)) {
        throw new Error("Codex models.json no longer contains a models array.");
    }

    const outputDirectory = fileURLToPath(new URL("../", import.meta.url));
    const profileDirectory = dirname(outputDirectory);
    const written: string[] = [];
    for (const target of CODEX_PROFILE_ARTIFACTS) {
        const matches = document.models.filter((model) => model.slug === target.slug);
        if (matches.length !== 1) {
            throw new Error(
                `Expected one Codex source model '${target.slug}', received ${matches.length}.`,
            );
        }
        const model = matches[0]!;
        if (model.model_messages?.instructions_template !== model.base_instructions) {
            throw new Error(`Codex '${target.slug}' instructions template diverged from its base.`);
        }
        const variables = model.model_messages.instructions_variables;
        if (
            variables?.personality_default !== "" ||
            variables.personality_friendly !== "" ||
            variables.personality_pragmatic !== ""
        ) {
            throw new Error(`Codex '${target.slug}' personality now changes its rendered prompt.`);
        }
        if (typeof model.tool_mode !== "string" || typeof model.multi_agent_version !== "string") {
            throw new Error(`Codex '${target.slug}' is missing tool-mode metadata.`);
        }
        if (model.tool_mode !== "code_mode_only") {
            throw new Error(
                `Codex '${target.slug}' tool_mode changed to '${model.tool_mode}'; update CODEX_PROFILE_ARTIFACTS.`,
            );
        }
        if (model.multi_agent_version !== target.multiAgentVersion) {
            throw new Error(
                `Codex '${target.slug}' multi_agent_version changed to '${model.multi_agent_version}'; update CODEX_PROFILE_ARTIFACTS.`,
            );
        }
        const expectedClientTools =
            model.multi_agent_version === "v2"
                ? ["exec", "wait", "request_user_input", "collaboration"]
                : ["exec", "wait", "request_user_input"];
        if (JSON.stringify(target.clientTools) !== JSON.stringify(expectedClientTools)) {
            throw new Error(
                `Codex '${target.slug}' client tool descriptor is stale for multi-agent ${model.multi_agent_version}.`,
            );
        }

        const goldenPrompt = model.base_instructions;
        const computedPrompt = computeCodexProfilePrompt(goldenPrompt, target);
        const goldenToolsPath = join(outputDirectory, `${target.stem}.tools.golden.json`);
        const goldenToolsJson = await readFile(goldenToolsPath, "utf8");
        const capture: CodexProfileCapture = {
            formatVersion: 1,
            source: {
                repository: "https://github.com/openai/codex",
                branch: "main",
                commit,
                commitDate,
                commitSubject: subjectLines.join("\n"),
                path: sourceRelativePath,
                captureMethod: "Read base_instructions directly from the checked-out Codex source",
            },
            model: {
                slug: model.slug,
                toolMode: model.tool_mode,
                multiAgentVersion: model.multi_agent_version,
                baseInstructionsSha256: createHash("sha256").update(goldenPrompt).digest("hex"),
                clientTools: target.clientTools,
            },
            tools: {
                client: toolCaptureClient,
                version: toolCaptureVersion,
                sourceDescription: toolCaptureSourceDescription,
                captureMethod: toolCaptureMethod,
                sha256: createHash("sha256").update(goldenToolsJson).digest("hex"),
            },
        };
        const promptPatch = await createUnifiedPatch({
            before: goldenPrompt,
            beforeName: `${target.stem}.golden.md`,
            after: computedPrompt,
            afterName: `${target.stem}.md`,
        });
        const computedToolsJson = `${JSON.stringify(computeCodexProfileTools(target), null, 2)}\n`;
        const toolsPatch = await createUnifiedPatch({
            before: goldenToolsJson,
            beforeName: `${target.stem}.tools.golden.json`,
            after: computedToolsJson,
            afterName: `${target.stem}.tools.json`,
        });
        const artifacts = [
            [`${target.stem}.capture.json`, `${JSON.stringify(capture, null, 2)}\n`],
            [`${target.stem}.golden.md`, goldenPrompt],
            [`${target.stem}.md`, computedPrompt],
            [`${target.stem}.patch`, promptPatch],
            [`${target.stem}.tools.json`, computedToolsJson],
            [`${target.stem}.tools.patch`, toolsPatch],
        ] as const;
        for (const [fileName, content] of artifacts) {
            const path = join(outputDirectory, fileName);
            await writeOrCheck(path, content, options.check);
            written.push(path);
        }
        const summaryPath = join(profileDirectory, `${target.stem}.md`);
        await writeOrCheck(
            summaryPath,
            createCodexProfileSummary({ target, capture, promptPatch, toolsPatch }),
            options.check,
        );
        written.push(summaryPath);
    }
    return written;
}

async function runGit(directory: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, { cwd: directory, encoding: "utf8" });
    return stdout.trimEnd();
}

async function writeOrCheck(path: string, content: string, check: boolean): Promise<void> {
    if (check) {
        const existing = await readFile(path, "utf8").catch(() => undefined);
        if (existing !== content) throw new Error(`Codex profile artifact is stale: ${path}`);
        return;
    }
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, path);
}
