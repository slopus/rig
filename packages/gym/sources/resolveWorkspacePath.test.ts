import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveWorkspacePath } from "./resolveWorkspacePath.js";

describe("resolveWorkspacePath", () => {
    it("rejects absolute fixture paths", () => {
        expect(() => resolveWorkspacePath("/tmp/gym-workspace", "/absolute.txt")).toThrow(
            "Gym path must stay inside /workspace: /absolute.txt",
        );
    });

    it("resolves relative fixture paths inside the workspace", () => {
        expect(resolveWorkspacePath("/tmp/gym-workspace", "src/input.ts")).toBe(
            join("/tmp/gym-workspace", "src/input.ts"),
        );
    });
});
