import { describe, expect, it } from "vitest";

import { createCodexCliRequest } from "@/vendors/codex/impl/createCodexCliRequest.js";

describe("Codex service tier", () => {
    it("writes the priority tier to the native request", () => {
        const request = createCodexCliRequest({
            clientMetadata: {},
            context: { instructions: "Test", messages: [] },
            effort: "low",
            model: "gpt-5.6-sol",
            promptCacheKey: "session",
            serviceTier: "priority",
            skills: [],
            tools: [],
        });

        expect(request.service_tier).toBe("priority");
    });
});
