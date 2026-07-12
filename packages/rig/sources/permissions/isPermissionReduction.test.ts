import { describe, expect, it } from "vitest";

import { isPermissionReduction } from "./isPermissionReduction.js";

describe("isPermissionReduction", () => {
    it("recognizes changes that revoke an existing process capability", () => {
        expect(isPermissionReduction("full_access", "workspace_write")).toBe(true);
        expect(isPermissionReduction("full_access", "auto")).toBe(true);
        expect(isPermissionReduction("workspace_write", "read_only")).toBe(true);
        expect(isPermissionReduction("auto", "read_only")).toBe(true);
        expect(isPermissionReduction("auto", "workspace_write")).toBe(true);
    });

    it("does not treat equal or broader permissions as a reduction", () => {
        expect(isPermissionReduction("read_only", "workspace_write")).toBe(false);
        expect(isPermissionReduction("workspace_write", "auto")).toBe(false);
        expect(isPermissionReduction("full_access", "full_access")).toBe(false);
    });
});
