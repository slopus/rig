import { describe, expect, it } from "vitest";

import { defineModel } from "@slopus/rig-execution";
import { createModelSwitchHistoryMessage } from "./createModelSwitchHistoryMessage.js";
import type { Message } from "./types.js";

describe("createModelSwitchHistoryMessage", () => {
    it("asks the model to investigate and includes bounded beginning and recent excerpts", () => {
        const messages: Message[] = Array.from({ length: 15 }, (_, index) => ({
            blocks: [{ text: `MESSAGE_${index + 1}`, type: "text" }],
            id: `message-${index + 1}`,
            role: index % 2 === 0 ? "user" : "agent",
        }));

        const message = createModelSwitchHistoryMessage({
            fromModel: model("openai/old", "Old model"),
            fromProviderId: "codex",
            id: "switch-history",
            canReadAgentHistory: true,
            messages,
            subagentCount: 2,
            toModel: model("anthropic/new", "New model"),
            toProviderId: "claude",
        });
        const text = message.blocks[0]?.type === "text" ? message.blocks[0].text : "";

        expect(text).toContain("investigate the prior Rig agent history");
        expect(text).toContain("read_agent_history");
        expect(text.toLocaleLowerCase()).not.toContain("handed off");
        expect(text.toLocaleLowerCase()).not.toContain("handoff");
        for (const included of [1, 2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15]) {
            expect(text).toContain(`MESSAGE_${included}`);
        }
        for (const omitted of [5, 6, 7]) {
            expect(text).not.toContain(`MESSAGE_${omitted}`);
        }
        expect(text).toContain("15 messages");
        expect(text).toContain("7 assistant messages");
        expect(text).toContain("2 subagents");
    });

    it("shares a fixed excerpt budget while retaining both ends of large history", () => {
        const messages: Message[] = Array.from({ length: 12 }, (_, index) => ({
            blocks: Array.from({ length: 20 }, (__, blockIndex) => ({
                text: `${index === 0 ? "HISTORY_FIRST" : index === 11 ? "HISTORY_LAST" : "MIDDLE"}-${blockIndex}-${"x".repeat(2_000)}`,
                type: "text" as const,
            })),
            id: `large-${index}`,
            role: "user" as const,
        }));

        const message = createModelSwitchHistoryMessage({
            canReadAgentHistory: false,
            fromModel: model("openai/old", "Old model"),
            fromProviderId: "codex",
            id: "bounded-history",
            messages,
            subagentCount: 0,
            toModel: model("anthropic/new", "New model"),
            toProviderId: "claude",
        });
        const text = message.blocks[0]?.type === "text" ? message.blocks[0].text : "";

        expect(text.length).toBeLessThanOrEqual(32_000);
        expect(text).toContain("HISTORY_FIRST");
        expect(text).toContain("HISTORY_LAST");
        expect(text).not.toContain("read_agent_history");
    });
});

function model(id: string, name: string) {
    return defineModel({
        defaultThinkingLevel: "off",
        id,
        name,
        thinkingLevels: ["off"],
    });
}
