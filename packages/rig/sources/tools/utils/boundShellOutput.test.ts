import { describe, expect, it } from "vitest";

import {
    boundShellOutput,
    SHELL_OUTPUT_MAX_BYTES,
    SHELL_OUTPUT_MAX_LINES,
} from "./boundShellOutput.js";

describe("boundShellOutput", () => {
    it.each([
        ["byte limit", "x".repeat(SHELL_OUTPUT_MAX_BYTES * 2)],
        ["line limit", "x\n".repeat(SHELL_OUTPUT_MAX_LINES + 100)],
    ])("keeps the truncation notice inside the advertised %s", (_case, input) => {
        const output = boundShellOutput(input);

        expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(SHELL_OUTPUT_MAX_BYTES);
        expect(output.split("\n").length).toBeLessThanOrEqual(SHELL_OUTPUT_MAX_LINES);
        expect(output).toContain("Earlier output was truncated");
    });
});
