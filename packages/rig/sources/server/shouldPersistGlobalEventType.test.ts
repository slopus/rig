import { describe, expect, it } from "vitest";

import { shouldPersistGlobalEventType } from "./shouldPersistGlobalEventType.js";

describe("shouldPersistGlobalEventType", () => {
    it("excludes streaming updates and account quota observations", () => {
        expect(shouldPersistGlobalEventType("agent_event")).toBe(false);
        expect(shouldPersistGlobalEventType("provider_quota_observed")).toBe(false);
    });

    it.each([
        "message_submitted",
        "steering_applied",
        "agent_message",
        "run_finished",
        "run_error",
    ] as const)("keeps the durable %s update", (type) => {
        expect(shouldPersistGlobalEventType(type)).toBe(true);
    });
});
