import { describe, expect, it } from "vitest";

import { createClaudeSessionId } from "./createClaudeSessionId.js";

describe("createClaudeSessionId", () => {
    it("returns a stable UUID for a Rig agent", () => {
        const first = createClaudeSessionId("agent-one");
        const second = createClaudeSessionId("agent-one");

        expect(first).toBe(second);
        expect(first).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    it("returns different UUIDs for different Rig agents", () => {
        expect(createClaudeSessionId("agent-one")).not.toBe(createClaudeSessionId("agent-two"));
    });
});
