import { accessSync, constants } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveClaudeCodeExecutablePath } from "@/index.js";

describe("resolveClaudeCodeExecutablePath", () => {
    it("finds an executable for the current platform", () => {
        const executablePath = resolveClaudeCodeExecutablePath();

        expect(() => accessSync(executablePath, constants.X_OK)).not.toThrow();
    });
});
