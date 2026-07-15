import { describe, expect, it } from "vitest";

import { sessionAgentFooterLabel } from "./sessionAgentFooterLabel.js";

describe("sessionAgentFooterLabel", () => {
    it("omits the default main identity", () => {
        expect(
            sessionAgentFooterLabel({ depth: 0, rootSessionId: "main", type: "primary" }),
        ).toBeUndefined();
    });

    it("keeps a human-readable subagent identity", () => {
        expect(
            sessionAgentFooterLabel({
                depth: 1,
                description: "Audit startup state",
                rootSessionId: "main",
                type: "subagent",
            }),
        ).toBe("Audit startup state [subagent]");
        expect(
            sessionAgentFooterLabel({
                depth: 1,
                rootSessionId: "main",
                taskName: "startup_status_audit",
                type: "subagent",
            }),
        ).toBe("Startup Status Audit [subagent]");
    });
});
