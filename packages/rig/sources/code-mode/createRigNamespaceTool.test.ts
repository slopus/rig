import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { codexFollowupTaskTool } from "../tools/codex/followup_task.js";
import { codexSpawnAgentTool } from "../tools/codex/spawn_agent.js";
import { createRigNamespaceTool } from "./createRigNamespaceTool.js";

describe("createRigNamespaceTool", () => {
    it("rejects native encrypted fields instead of forwarding ciphertext", async () => {
        const spawn = createRigNamespaceTool(codexSpawnAgentTool);
        const args = {
            context: "task",
            encrypted_message: "opaque-cloud-ciphertext",
            message: "",
            model: "openai/gpt-5.6-sol",
            provider: "bedrock",
            task_name: "unsafe_crossing",
        };

        expect(Value.Check(spawn.arguments, args)).toBe(false);
        expect(() => spawn.execute(args as never, createJustBashToolHarness().context, {})).toThrow(
            "native encrypted collaboration fields cannot cross providers or regions",
        );
    });

    it("reviews provider/model/context disclosure in Auto without changing native tools", async () => {
        const spawn = createRigNamespaceTool(codexSpawnAgentTool);
        const followup = createRigNamespaceTool(codexFollowupTaskTool);
        const context = createJustBashToolHarness().context;

        expect(
            await spawn.shouldReviewInAutoMode(
                { context: "task", message: "task", task_name: "local" } as never,
                context,
            ),
        ).toBe(false);
        expect(
            await spawn.shouldReviewInAutoMode(
                {
                    context: "task",
                    message: "task",
                    model: "anthropic/fable-5",
                    provider: "claude",
                    task_name: "external",
                } as never,
                context,
            ),
        ).toBe(true);
        expect(
            await followup.shouldReviewInAutoMode(
                { message: "more work", target: "/root/external" } as never,
                context,
            ),
        ).toBe(true);
        expect(
            spawn.describeAutoPermissionAction?.(
                {
                    context: "parent",
                    message: "task",
                    model: "anthropic/fable-5",
                    provider: "claude",
                    task_name: "external",
                } as never,
                context,
            ),
        ).toContain("parent conversation context");
    });
});
