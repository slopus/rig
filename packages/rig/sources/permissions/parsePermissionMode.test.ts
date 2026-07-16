import { describe, expect, it } from "vitest";

import { parsePermissionMode } from "./parsePermissionMode.js";

describe("parsePermissionMode", () => {
    it("names the exact accepted input values", () => {
        expect(() => parsePermissionMode("Workspace write")).toThrow(
            "Permission mode must be one of: auto, workspace_write, read_only, or full_access.",
        );
    });
});
