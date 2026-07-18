import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentContext } from "../agent/context/AgentContext.js";
import { claudeBashTool } from "../tools/claude/Bash.js";
import { claudeReadTool } from "../tools/claude/Read.js";
import { claudeWriteTool } from "../tools/claude/Write.js";
import { codexApplyPatchTool } from "../tools/codex/apply_patch.js";
import { codexExecCommandTool } from "../tools/codex/exec_command.js";
import { codexViewImageTool } from "../tools/codex/view_image.js";
import { codexWriteStdinTool } from "../tools/codex/write_stdin.js";
import { grokReadFileTool } from "../tools/grok/read_file.js";
import { grokRunTerminalCommandTool } from "../tools/grok/run_terminal_command.js";
import { grokSearchReplaceTool } from "../tools/grok/search_replace.js";
import { piBashTool } from "../tools/pi/bash.js";
import { piReadTool } from "../tools/pi/read.js";
import { codexWorkflowTool } from "../tools/workflows/workflowTools.js";

describe("tool-owned Auto permission policies", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories
                .splice(0)
                .map((path) => rm(path, { force: true, recursive: true })),
        );
    });

    it("keeps ordinary shells sandboxed and reviews only explicit escalation or input", async () => {
        const context = await makeContext(temporaryDirectories);

        expect(
            await codexExecCommandTool.shouldReviewInAutoMode({ cmd: "pnpm test" }, context),
        ).toBe(false);
        expect(
            await codexExecCommandTool.shouldRunInFullAccessInAutoMode(
                { cmd: "pnpm test", sandbox_permissions: "require_escalated" },
                context,
            ),
        ).toBe(true);
        expect(await claudeBashTool.shouldReviewInAutoMode({ command: "pnpm test" }, context)).toBe(
            false,
        );
        expect(
            await claudeBashTool.shouldRunInFullAccessInAutoMode(
                { command: "pnpm test", dangerouslyDisableSandbox: true },
                context,
            ),
        ).toBe(true);
        expect(await piBashTool.shouldReviewInAutoMode({ command: "pnpm test" }, context)).toBe(
            false,
        );
        const piEscalation = {
            command: "pnpm test",
            justification: "The sandbox blocked the package manager cache.",
            sandbox_permissions: "require_escalated",
        };
        expect(Value.Check(piBashTool.arguments, piEscalation)).toBe(true);
        expect(await piBashTool.shouldReviewInAutoMode(piEscalation as never, context)).toBe(true);
        expect(
            await piBashTool.shouldRunInFullAccessInAutoMode(piEscalation as never, context),
        ).toBe(true);
        expect(
            await grokRunTerminalCommandTool.shouldReviewInAutoMode(
                {
                    background: false,
                    command: "pnpm test",
                    description: "Run tests.",
                },
                context,
            ),
        ).toBe(false);
        const grokEscalation = {
            background: false,
            command: "pnpm test",
            description: "Run tests after the sandbox blocked the package manager cache.",
            sandbox_permissions: "require_escalated",
        };
        expect(Value.Check(grokRunTerminalCommandTool.arguments, grokEscalation)).toBe(true);
        expect(
            await grokRunTerminalCommandTool.shouldReviewInAutoMode(
                grokEscalation as never,
                context,
            ),
        ).toBe(true);
        expect(
            await grokRunTerminalCommandTool.shouldRunInFullAccessInAutoMode(
                grokEscalation as never,
                context,
            ),
        ).toBe(true);
        expect(await codexWriteStdinTool.shouldReviewInAutoMode({ session_id: 1 }, context)).toBe(
            false,
        );
        expect(
            await codexWriteStdinTool.shouldReviewInAutoMode(
                { chars: "deploy\n", session_id: 1 },
                context,
            ),
        ).toBe(true);
        expect(
            await codexWriteStdinTool.shouldRunInFullAccessInAutoMode(
                { chars: "deploy\n", session_id: 1 },
                context,
            ),
        ).toBe(false);
        expect(
            codexWriteStdinTool.describeAutoPermissionAction?.(
                { chars: "deploy\n", session_id: 1 },
                context,
            ),
        ).toBe('sending "deploy\\n" to shell session 1');
    });

    it("lets each file tool expose its own path while sharing boundary checks", async () => {
        const context = await makeContext(temporaryDirectories);
        const outside = join(context.fs.cwd, "..", "outside.txt");
        await writeFile(outside, "outside");
        const link = join(context.fs.cwd, "outside-link");
        await symlink(outside, link);
        const inside = join(context.fs.cwd, "inside.txt");
        const insideWorkflow = join(context.fs.cwd, "workflow.py");
        await writeFile(insideWorkflow, "'done'");
        const hook = join(context.fs.cwd, ".git", "hooks", "pre-commit");
        await mkdir(join(context.fs.cwd, ".git", "hooks"), { recursive: true });
        const userSkill = join(context.fs.home ?? "", ".codex", "skills", "review", "SKILL.md");
        await mkdir(join(context.fs.home ?? "", ".codex", "skills", "review"), {
            recursive: true,
        });
        await writeFile(userSkill, "# Review");

        await expect(
            claudeReadTool.shouldReviewInAutoMode({ file_path: outside }, context),
        ).resolves.toBe(true);
        await expect(
            claudeReadTool.shouldReviewInAutoMode({ file_path: userSkill }, context),
        ).resolves.toBe(false);
        await expect(
            claudeReadTool.shouldRunInFullAccessInAutoMode({ file_path: outside }, context),
        ).resolves.toBe(true);
        await expect(
            claudeWriteTool.shouldReviewInAutoMode(
                { content: "inside", file_path: inside },
                context,
            ),
        ).resolves.toBe(false);
        await expect(
            claudeWriteTool.shouldReviewInAutoMode({ content: "hook", file_path: hook }, context),
        ).resolves.toBe(true);
        await expect(piReadTool.shouldReviewInAutoMode({ path: link }, context)).resolves.toBe(
            true,
        );
        await expect(
            grokReadFileTool.shouldReviewInAutoMode({ target_file: outside }, context),
        ).resolves.toBe(true);
        await expect(
            grokSearchReplaceTool.shouldReviewInAutoMode(
                { file_path: outside, new_string: "new", old_string: "old" },
                context,
            ),
        ).resolves.toBe(true);
        await expect(
            codexViewImageTool.shouldReviewInAutoMode({ path: outside }, context),
        ).resolves.toBe(true);
        await expect(
            codexApplyPatchTool.shouldReviewInAutoMode(
                {
                    patch: "*** Begin Patch\n*** Update File: inside.txt\n*** End Patch",
                },
                context,
            ),
        ).resolves.toBe(false);
        await expect(
            codexApplyPatchTool.shouldReviewInAutoMode(
                {
                    patch: `*** Begin Patch\n*** Update File: ${outside}\n*** End Patch`,
                },
                context,
            ),
        ).resolves.toBe(true);
        expect(await codexWorkflowTool.shouldReviewInAutoMode({ script: "'done'" }, context)).toBe(
            false,
        );
        expect(
            await codexWorkflowTool.shouldReviewInAutoMode({ scriptPath: insideWorkflow }, context),
        ).toBe(false);
        expect(
            await codexWorkflowTool.shouldReviewInAutoMode({ scriptPath: outside }, context),
        ).toBe(true);
        expect(
            await codexWorkflowTool.shouldRunInFullAccessInAutoMode(
                { scriptPath: outside },
                context,
            ),
        ).toBe(true);
        expect(
            codexWorkflowTool.describeAutoPermissionAction?.({ scriptPath: outside }, context),
        ).toBe(
            `reading workflow script ${JSON.stringify(outside)}. Access: unrestricted filesystem access outside the workspace sandbox`,
        );
        expect(claudeReadTool.describeAutoPermissionAction?.({ file_path: outside }, context)).toBe(
            `reading ${JSON.stringify(outside)}. Access: unrestricted filesystem access outside the workspace sandbox`,
        );
        expect(
            claudeWriteTool.describeAutoPermissionAction?.(
                { content: "hook", file_path: hook },
                context,
            ),
        ).toBe(
            `writing ${JSON.stringify(hook)}. Access: protected Git control path inside the workspace`,
        );
    });

    it("lets apply_patch disclose every affected path and its full-access boundary", async () => {
        const context = await makeContext(temporaryDirectories);
        const outside = join(context.fs.cwd, "..", "outside.txt");
        const renamed = join(context.fs.cwd, "..", "renamed.txt");
        const describe = codexApplyPatchTool.describeAutoPermissionAction;

        expect(describe).toBeDefined();
        if (describe === undefined) return;

        const action = describe(
            {
                patch: [
                    "*** Begin Patch",
                    "*** Update File: ../outside.txt",
                    "*** Move to: ../renamed.txt",
                    "*** End Patch",
                ].join("\n"),
            },
            context,
        );

        expect(action).toContain(`Affected paths: "${outside}", "${renamed}"`);
        expect(action).toContain(`Working directory: "${context.fs.cwd}"`);
        expect(action).toContain(
            "Access: unrestricted filesystem access outside the workspace sandbox",
        );
    });
});

async function makeContext(temporaryDirectories: string[]): Promise<AgentContext> {
    const root = await mkdtemp(join(tmpdir(), "rig-tool-auto-policy-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const home = join(root, "home");
    await Promise.all([mkdir(cwd), mkdir(home)]);
    return { fs: { cwd, home } } as AgentContext;
}
