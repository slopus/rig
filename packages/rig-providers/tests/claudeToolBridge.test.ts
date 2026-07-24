import { describe, expect, it } from "vitest";

import { ClaudeToolBridge } from "@/vendors/claude/impl/ClaudeToolBridge.js";

describe("ClaudeToolBridge", () => {
    it("joins resolvers and answers arriving in either order", async () => {
        const bridge = new ClaudeToolBridge();
        bridge.register("first-bash", "Bash");
        bridge.register("second-bash", "Bash");
        const firstResult = bridge.execute("Bash");

        expect(
            bridge.resolveAll([
                { role: "tool", callId: "first-bash", content: "first complete" },
                { role: "tool", callId: "second-bash", content: "second complete" },
            ]),
        ).toBe(true);
        const secondResult = bridge.execute("Bash");

        await expect(firstResult).resolves.toMatchObject({
            content: [{ type: "text", text: "first complete" }],
        });
        await expect(secondResult).resolves.toMatchObject({
            content: [{ type: "text", text: "second complete" }],
        });
    });

    it("requires the complete batch and preserves the first answer for a call", async () => {
        const bridge = new ClaudeToolBridge();
        bridge.register("first", "Read");
        bridge.register("second", "Read");

        expect(
            bridge.resolveAll([
                { role: "tool", callId: "first", content: "first answer" },
                { role: "tool", callId: "unknown", content: "unknown answer" },
            ]),
        ).toBe(false);
        expect(
            bridge.resolve({ role: "tool", callId: "first", content: "replacement answer" }),
        ).toBe(false);

        await expect(bridge.execute("Read")).resolves.toMatchObject({
            content: [{ type: "text", text: "first answer" }],
        });
        const second = bridge.execute("Read");
        expect(bridge.resolve({ role: "tool", callId: "second", content: "second answer" })).toBe(
            true,
        );
        await expect(second).resolves.toMatchObject({
            content: [{ type: "text", text: "second answer" }],
        });
    });
});
