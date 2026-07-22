import { describe, expect, it } from "vitest";

import { codexCollaborationTools, codexTools } from "../tools/codex/index.js";
import { CodexBedrockToolSearchAdapter } from "./CodexBedrockToolSearchAdapter.js";

describe("CodexBedrockToolSearchAdapter", () => {
    it("matches Codex's deferred multi_agent_v1 discovery surface", async () => {
        const adaptation = new CodexBedrockToolSearchAdapter().adapt([
            ...codexTools,
            ...codexCollaborationTools,
        ]);

        expect(adaptation.exposedTools.map((tool) => tool.name)).toEqual([
            "exec_command",
            "write_stdin",
            "update_plan",
            "request_user_input",
            "apply_patch",
            "view_image",
            "tool_search",
        ]);
        expect(adaptation.exposedTools.at(-1)?.providerTool).toMatchObject({
            kind: "tool_search",
            execution: "client",
        });
        expect(
            adaptation.nestedTools
                .filter((tool) => tool.codeMode?.namespace === "multi_agent_v1")
                .map((tool) => tool.name),
        ).toEqual(["spawn_agent", "close_agent", "resume_agent", "wait_agent", "send_input"]);
        expect(adaptation.nestedTools).toHaveLength(5);

        const toolSearch = adaptation.exposedTools.at(-1)!;
        const result = await toolSearch.execute(
            { query: "spawn and manage sub-agents" } as never,
            {} as never,
            {},
        );
        expect(result).toMatchObject({
            tools: [
                {
                    type: "namespace",
                    name: "multi_agent_v1",
                    tools: [
                        { name: "spawn_agent" },
                        { name: "close_agent" },
                        { name: "resume_agent" },
                        { name: "wait_agent" },
                        { name: "send_input" },
                    ],
                },
            ],
        });
    });

    it("interrupts a running agent before delivering immediate input", async () => {
        const adaptation = new CodexBedrockToolSearchAdapter().adapt([
            ...codexTools,
            ...codexCollaborationTools,
        ]);
        const sendInput = adaptation.nestedTools.find((tool) => tool.name === "send_input")!;
        const events: string[] = [];

        await sendInput.execute(
            { target: "agent-1", message: "New direction", interrupt: true } as never,
            {
                subagents: {
                    interrupt: async () => {
                        await Promise.resolve();
                        events.push("interrupt");
                        return {};
                    },
                    followUp: () => {
                        events.push("followup");
                        return {};
                    },
                },
            } as never,
            {},
        );

        expect(events).toEqual(["interrupt", "followup"]);
    });
});
