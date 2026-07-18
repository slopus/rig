import { describe, expect, it, vi } from "vitest";

import type { AgentContext } from "../agent/context/AgentContext.js";
import type { ToolExecutionOptions } from "../agent/types.js";
import { createDurableSkillTool } from "./createDurableSkillTool.js";

describe("createDurableSkillTool", () => {
    it("owns its external boundary policy and publishes the selected skill", async () => {
        const invoke = vi.fn(async () => ({
            output: "# Release check",
            status: "completed" as const,
        }));
        const tool = createDurableSkillTool({
            invoke,
            skills: [
                {
                    description: "Check a release.",
                    location: "durable",
                    name: "release-check",
                },
            ],
        });
        const context = {} as AgentContext;

        expect(tool.execution).toBe("durable");
        expect(tool.requiresAutoOrFullAccess).toBe(true);
        await expect(
            Promise.resolve(
                tool.shouldReviewInAutoMode({ name: "release-check" } as never, context),
            ),
        ).resolves.toBe(true);
        await expect(
            Promise.resolve(
                tool.shouldRunInFullAccessInAutoMode({ name: "release-check" } as never, context),
            ),
        ).resolves.toBe(false);
        expect(
            tool.describeAutoPermissionAction?.({ name: "release-check" } as never, context),
        ).toContain("outside Rig's sandbox");

        const execute = tool.execute as unknown as (
            args: { name: string },
            context: AgentContext,
            options: ToolExecutionOptions,
        ) => Promise<unknown>;
        await expect(
            execute({ name: "release-check" }, context, {
                toolBatchId: "batch-1",
                toolCallId: "call-1",
                toolCallIndex: 0,
            }),
        ).resolves.toMatchObject({ output: "# Release check", status: "completed" });
        expect(invoke).toHaveBeenCalledWith(
            expect.objectContaining({ location: "durable", name: "release-check" }),
            {
                arguments: { name: "release-check" },
                batchId: "batch-1",
                toolCallId: "call-1",
                toolCallIndex: 0,
            },
            undefined,
        );
    });

    it("rejects an unconfigured skill without crossing the external boundary", async () => {
        const invoke = vi.fn();
        const tool = createDurableSkillTool({ invoke, skills: [] });
        const execute = tool.execute as unknown as (
            args: { name: string },
            context: AgentContext,
            options: ToolExecutionOptions,
        ) => Promise<unknown>;

        await expect(execute({ name: "missing" }, {} as AgentContext, {})).resolves.toEqual({
            error: { message: "Durable skill 'missing' is not configured." },
            status: "failed",
        });
        expect(invoke).not.toHaveBeenCalled();
    });
});
