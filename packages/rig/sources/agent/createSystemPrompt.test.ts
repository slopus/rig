import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentContext } from "./context/AgentContext.js";
import { createNodeFileSystemContext } from "./context/createNodeFileSystemContext.js";
import { createSystemPrompt } from "./createSystemPrompt.js";
import { CLAUDE_CODE_SYSTEM_PROMPT } from "./prompts/claudeCodeSystemPrompt.js";
import { GPT_5_4_SYSTEM_PROMPT } from "./prompts/gpt54SystemPrompt.js";
import { GPT_5_5_SYSTEM_PROMPT } from "./prompts/gpt55SystemPrompt.js";
import { GPT_5_6_SOL_SYSTEM_PROMPT } from "./prompts/gpt56SolSystemPrompt.js";
import { GPT_5_6_TERRA_SYSTEM_PROMPT } from "./prompts/gpt56TerraSystemPrompt.js";
import { KIMI_SYSTEM_PROMPT } from "./prompts/kimiSystemPrompt.js";
import type { Message } from "./types.js";
import { createPermissionContext, type PermissionMode } from "../permissions/index.js";
import { defineModel, defineProvider, type Model, type Provider } from "../providers/types.js";
import { SecretRegistry, SessionSecretContext } from "../secrets/index.js";
import { claudeBashTool } from "../tools/claude/Bash.js";
import { codexExecCommandTool } from "../tools/codex/exec_command.js";
import { grokRunTerminalCommandTool } from "../tools/grok/run_terminal_command.js";
import { piBashTool } from "../tools/pi/bash.js";

const tempDirs: string[] = [];

describe("createSystemPrompt", () => {
    it("uses an exact integration system prompt without assembled Rig instructions", async () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "mock/model",
            name: "Mock",
            thinkingLevels: ["off"],
        });
        const provider = providerFor("mock", model);

        await expect(
            createSystemPrompt({
                context: contextFor("/tmp/rig-exact-system-prompt"),
                instructions: "Internal instructions.",
                messages: [],
                model,
                provider,
                systemPrompt: "Exact external prompt.",
            }),
        ).resolves.toBe("Exact external prompt.");
    });

    afterEach(async () => {
        await Promise.all(
            tempDirs.splice(0).map((path) =>
                rm(path, {
                    recursive: true,
                    force: true,
                }),
            ),
        );
    });

    it("adds the GPT-5.5 prompt and AGENTS.md instructions from project root to cwd", async () => {
        const root = await makeTempDir();
        const nested = join(root, "packages", "app");
        await mkdir(nested, { recursive: true });
        await writeFile(join(root, ".git"), "gitdir: here");
        await writeFile(join(root, "AGENTS.override.md"), "do not include override");
        await writeFile(join(root, "AGENTS.md"), "root rule");
        await writeFile(join(root, "CLAUDE.md"), "do not include claude");
        await writeFile(join(nested, "AGENTS.md"), "nested rule");

        const model = defineModel({
            id: "openai/gpt-5.5",
            name: "GPT-5.5",
            thinkingLevels: ["off", "medium"],
            defaultThinkingLevel: "medium",
        });
        const prompt = await createSystemPrompt({
            provider: providerFor("codex", model),
            model,
            instructions: "Base instructions.",
            messages: [
                {
                    role: "system",
                    id: "system-1",
                    blocks: [{ type: "text", text: "Keep answers short." }],
                },
            ],
            context: contextFor(nested),
        });

        expect(prompt?.startsWith(GPT_5_5_SYSTEM_PROMPT)).toBe(true);
        expect(prompt).toContain("You are Codex, a coding agent based on GPT-5.");
        expect(prompt).not.toContain("You are GPT-5.2 running in the Codex CLI");
        expect(prompt).not.toContain("IGN-CMD");
        expect(prompt).toContain("Base instructions.");
        expect(prompt).toContain("Keep answers short.");
        expect(prompt).toContain(`# AGENTS.md instructions for ${nested}`);
        expect(prompt).toContain("<INSTRUCTIONS>\nroot rule\n\nnested rule\n</INSTRUCTIONS>");
        expect(prompt).not.toContain("do not include override");
        expect(prompt).not.toContain("do not include claude");
    });

    it("uses the GPT-5.4 prompt for GPT-5.4 models", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "openai/gpt-5.4",
            name: "GPT-5.4",
            thinkingLevels: ["off", "medium"],
            defaultThinkingLevel: "medium",
        });

        const prompt = await createSystemPrompt({
            provider: providerFor("codex", model),
            model,
            messages: [],
            context: contextFor(cwd),
        });

        expect(prompt).toBe(GPT_5_4_SYSTEM_PROMPT);
        expect(prompt).toContain("You are Codex, a coding agent based on GPT-5.");
        expect(prompt).not.toContain("You are GPT-5.2 running in the Codex CLI");
        expect(prompt).not.toContain("IGN-CMD");
    });

    it("uses the current Codex prompt for GPT-5.6 models", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "openai/gpt-5.6-sol",
            name: "GPT-5.6 Sol",
            thinkingLevels: ["off", "medium"],
            defaultThinkingLevel: "medium",
        });

        await expect(
            createSystemPrompt({
                provider: providerFor("codex", model),
                model,
                messages: [],
                context: contextFor(cwd),
            }),
        ).resolves.toBe(GPT_5_6_SOL_SYSTEM_PROMPT);
    });

    it("uses Terra's current Codex prompt for GPT-5.6 Terra and Luna", async () => {
        const cwd = await makeTempDir();

        for (const variant of ["terra", "luna"] as const) {
            const model = defineModel({
                id: `openai/gpt-5.6-${variant}`,
                name: `GPT-5.6 ${variant}`,
                thinkingLevels: ["off", "medium"],
                defaultThinkingLevel: "medium",
            });

            await expect(
                createSystemPrompt({
                    provider: providerFor("codex", model),
                    model,
                    messages: [],
                    context: contextFor(cwd),
                }),
            ).resolves.toBe(GPT_5_6_TERRA_SYSTEM_PROMPT);
        }
    });

    it("does not fall back to a GPT prompt for unsupported GPT models", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "openai/gpt-5.2",
            name: "GPT-5.2",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });

        await expect(
            createSystemPrompt({
                provider: providerFor("codex", model),
                model,
                instructions: "Base instructions.",
                messages: [],
                context: contextFor(cwd),
            }),
        ).resolves.toBe("Base instructions.");
    });

    it("tells the model which permission boundary is active", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const context = contextFor(cwd);
        context.permissions = createPermissionContext("read_only");

        await expect(
            createSystemPrompt({
                provider: providerFor("mock", model),
                model,
                messages: [],
                context,
            }),
        ).resolves.toContain(
            "You are in Read only mode. You may inspect files and run non-mutating shell commands.",
        );
    });

    it("appends API-provided text after every generated prompt section", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const context = contextFor(cwd);
        context.permissions = createPermissionContext("read_only");

        const prompt = await createSystemPrompt({
            appendSystemPrompt: "Final API instructions.",
            provider: providerFor("mock", model),
            model,
            instructions: "Base instructions.",
            messages: [],
            context,
        });

        expect(prompt).toContain("Base instructions.");
        expect(prompt).toContain("You are in Read only mode.");
        expect(prompt?.endsWith("Final API instructions.")).toBe(true);
    });

    it("adds the active shell tool's provider-specific Auto escalation instructions", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const context = contextFor(cwd);
        context.permissions = createPermissionContext("auto");
        const cases = [
            [
                codexExecCommandTool,
                'exec_command, request full-access execution with sandbox_permissions: "require_escalated"',
            ],
            [
                claudeBashTool,
                "Bash, request full-access execution with dangerouslyDisableSandbox: true",
            ],
            [
                piBashTool,
                'bash, request full-access execution with sandbox_permissions: "require_escalated"',
            ],
            [
                grokRunTerminalCommandTool,
                'run_terminal_command, request full-access execution with sandbox_permissions: "require_escalated"',
            ],
        ] as const;

        for (const [tool, expected] of cases) {
            const prompt = await createSystemPrompt({
                provider: providerFor("mock", model),
                model,
                messages: [],
                context,
                tools: [tool],
            });

            expect(prompt).toContain(
                "Every shell tool uses the same workspace sandbox by default.",
            );
            expect(prompt).toContain(expected);
        }
    });

    it("describes attached bundles without exposing values or the old shell argument", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const context = contextFor(cwd);
        const registry = new SecretRegistry([
            {
                description: "Service API credentials",
                environment: {
                    SERVICE_REGION: "never-show-this-region",
                    SERVICE_TOKEN: "never-show-this-token",
                },
                id: "service",
            },
            {
                description: "Production database credentials",
                environment: { DATABASE_URL: "never-show-this-database" },
                id: "database",
            },
        ]);
        context.secrets = new SessionSecretContext(registry, ["service"], ["database"]);

        const prompt = await createSystemPrompt({
            provider: providerFor("mock", model),
            model,
            messages: [],
            context,
        });

        expect(prompt).toContain('- "service": Service API credentials');
        expect(prompt).toContain("Environment variables: SERVICE_REGION, SERVICE_TOKEN");
        expect(prompt).toContain('- "database": Production database credentials');
        expect(prompt).toContain("Environment variables: DATABASE_URL");
        expect(prompt).toContain("`secrets` argument to the IDs");
        expect(prompt).toContain("Use an empty array");
        expect(prompt).not.toContain("never-show-this-token");
        expect(prompt).not.toContain("never-show-this-region");
        expect(prompt).not.toContain("never-show-this-database");
        expect(prompt).not.toContain("secret_ids");
    });

    it("uses the Claude Code prompt for modern Anthropic models", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "anthropic/sonnet-4-6",
            name: "Sonnet 4.6",
            thinkingLevels: ["off", "medium"],
            defaultThinkingLevel: "medium",
        });

        await expect(
            createSystemPrompt({
                provider: providerFor("anthropic", model),
                model,
                messages: [],
                context: contextFor(cwd),
            }),
        ).resolves.toBe(CLAUDE_CODE_SYSTEM_PROMPT);
    });

    it("uses Moonshot's official Kimi identity prompt", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "moonshot/kimi-k2.5",
            name: "Kimi K2.5",
            thinkingLevels: ["off", "on"],
            defaultThinkingLevel: "on",
        });

        await expect(
            createSystemPrompt({
                provider: providerFor("bedrock", model),
                model,
                messages: [],
                context: contextFor(cwd),
            }),
        ).resolves.toBe(KIMI_SYSTEM_PROMPT);
    });

    it("assembles explicit instructions for unsupported test models", async () => {
        const cwd = await makeTempDir();
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const messages: readonly Message[] = [
            {
                role: "system",
                id: "system-1",
                blocks: [{ type: "text", text: "Keep answers short." }],
            },
        ];

        await expect(
            createSystemPrompt({
                provider: providerFor("codex", model),
                model,
                instructions: "Base instructions.",
                messages,
                context: contextFor(cwd),
            }),
        ).resolves.toBe("Base instructions.\n\nKeep answers short.");
    });

    it("does not load CLAUDE.md when AGENTS.md is absent", async () => {
        const cwd = await makeTempDir();
        await writeFile(join(cwd, ".git"), "gitdir: here");
        await writeFile(join(cwd, "CLAUDE.md"), "do not include claude");
        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });

        await expect(
            createSystemPrompt({
                provider: providerFor("mock", model),
                model,
                instructions: "Base instructions.",
                messages: [],
                context: contextFor(cwd),
            }),
        ).resolves.toBe("Base instructions.");
    });

    it("adds available skills from Codex roots and ignores Pi skill roots", async () => {
        const root = await makeTempDir();
        const nested = join(root, "packages", "app");
        await mkdir(nested, { recursive: true });
        await writeFile(join(root, ".git"), "gitdir: here");

        const home = join(root, ".home");
        const codexSkill = join(home, ".codex", "skills", "review", "SKILL.md");
        const projectSkill = join(root, ".agents", "skills", "build", "SKILL.md");
        const nestedPiSkill = join(nested, ".pi", "skills", "tester", "SKILL.md");
        await mkdir(dirname(codexSkill), { recursive: true });
        await mkdir(dirname(projectSkill), { recursive: true });
        await mkdir(dirname(nestedPiSkill), { recursive: true });
        await writeFile(
            codexSkill,
            "---\nname: review\ndescription: Review changes carefully.\n---\n\n# Review\n",
        );
        await writeFile(
            projectSkill,
            "---\nname: build\ndescription: >\n  Build and verify\n  local changes.\n---\n\n# Build\n",
        );
        await writeFile(
            nestedPiSkill,
            "---\nname: tester\ndescription: Test the application.\n---\n\n# Test\n",
        );

        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });

        const prompt = await createSystemPrompt({
            provider: providerFor("mock", model),
            model,
            messages: [],
            context: contextFor(nested, home, "workspace_write"),
        });

        expect(prompt).toContain("# Skills");
        expect(prompt).toContain("<available_skills>");
        expect(prompt).toContain("<name>build</name>");
        expect(prompt).toContain("<description>Build and verify local changes.</description>");
        expect(prompt).toContain(`<location>${projectSkill}</location>`);
        expect(prompt).toContain("<name>review</name>");
        expect(prompt).toContain(`<location>${codexSkill}</location>`);
        expect(prompt).not.toContain("<name>tester</name>");
        expect(prompt).not.toContain(`<location>${nestedPiSkill}</location>`);
        expect(prompt).toContain("Read the complete skill file before taking task actions");
        expect(prompt).not.toContain("# Review");
        expect(prompt).not.toContain("# Build");
        expect(prompt).not.toContain("# Test");
    });

    it("ignores Claude-only executable skill frontmatter fields", async () => {
        const root = await makeTempDir();
        await writeFile(join(root, ".git"), "gitdir: here");
        const skillPath = join(root, ".agents", "skills", "safe", "SKILL.md");
        await mkdir(dirname(skillPath), { recursive: true });
        await writeFile(
            skillPath,
            [
                "---",
                "name: safe",
                "description: Safe instructions only.",
                "allowed-tools:",
                "  - Bash",
                "shell: bash",
                "hooks:",
                "  PreToolUse:",
                "    - matcher: Bash",
                "---",
                "",
                "This body should be read explicitly when needed.",
            ].join("\n"),
        );

        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });

        const prompt = await createSystemPrompt({
            provider: providerFor("mock", model),
            model,
            messages: [],
            context: contextFor(root),
        });

        expect(prompt).toContain("<name>safe</name>");
        expect(prompt).toContain("<description>Safe instructions only.</description>");
        expect(prompt).not.toContain("allowed-tools");
        expect(prompt).not.toContain("shell: bash");
        expect(prompt).not.toContain("PreToolUse");
        expect(prompt).not.toContain("This body should be read explicitly");
    });

    it("ignores Claude-only model invocation frontmatter", async () => {
        const root = await makeTempDir();
        await writeFile(join(root, ".git"), "gitdir: here");
        const skillPath = join(root, ".agents", "skills", "manual", "SKILL.md");
        await mkdir(dirname(skillPath), { recursive: true });
        await writeFile(
            skillPath,
            "---\nname: manual\ndescription: Manual-only skill.\ndisable-model-invocation: true\n---\n\n# Manual\n",
        );

        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });

        await expect(
            createSystemPrompt({
                provider: providerFor("mock", model),
                model,
                messages: [],
                context: contextFor(root),
            }),
        ).resolves.toContain("<name>manual</name>");
    });
});

function providerFor(id: string, model: Model): Provider {
    return defineProvider({
        id,
        models: [model],
        stream() {
            throw new Error("stream is not used by createSystemPrompt tests");
        },
    });
}

function contextFor(
    cwd: string,
    home = join(cwd, ".home"),
    permissionMode: PermissionMode = "full_access",
): AgentContext {
    return {
        fs: createNodeFileSystemContext(cwd, { home, permissionMode: () => permissionMode }),
        bash: {
            cwd,
            async killSession() {
                return undefined;
            },
            async readSession() {
                return undefined;
            },
            async run() {
                return {
                    stdout: "",
                    stderr: "",
                    exitCode: 0,
                    timedOut: false,
                };
            },
            async startSession() {
                return 1;
            },
            supportsSessionInput: false,
            async writeSession() {
                return false;
            },
        },
    };
}

async function makeTempDir(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "rig-system-prompt-"));
    tempDirs.push(path);
    return path;
}
