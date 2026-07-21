import { describe, expect, it } from "vitest";

import { resolveHappyIntegrationMode } from "./resolveHappyIntegrationMode.js";

describe("resolveHappyIntegrationMode", () => {
    it.each([
        [undefined, true, "disabled"],
        ["disabled", true, "disabled"],
        ["enabled", false, "disabled"],
        ["enabled", true, "enabled"],
    ] as const)("resolves host %s and config %s to %s", (host, configured, expected) => {
        expect(resolveHappyIntegrationMode(host, configured)).toBe(expected);
    });
});
