import { describe, expect, it } from "vitest";

import { parseCodeModeExecInput } from "./parseCodeModeExecInput.js";

describe("parseCodeModeExecInput", () => {
    it("preserves plain JavaScript", () => {
        expect(parseCodeModeExecInput("text('ok')")).toEqual({ code: "text('ok')" });
    });

    it("extracts the official first-line pragma", () => {
        expect(
            parseCodeModeExecInput(
                '// @exec: {"yield_time_ms": 25, "max_output_tokens": 40}\ntext("ok")',
            ),
        ).toEqual({ code: 'text("ok")', maxOutputTokens: 40, yieldTimeMs: 25 });
    });

    it("rejects unsupported pragma fields", () => {
        expect(() => parseCodeModeExecInput('// @exec: {"other": 1}\ntext("ok")')).toThrow(
            "only supports",
        );
    });

    it("accepts the native signed 32-bit max_output_tokens limit", () => {
        expect(
            parseCodeModeExecInput('// @exec: {"max_output_tokens": 2147483647}\ntext("ok")'),
        ).toMatchObject({ maxOutputTokens: 2_147_483_647 });
    });

    it("rejects max_output_tokens values outside the native signed 32-bit range", () => {
        expect(() =>
            parseCodeModeExecInput('// @exec: {"max_output_tokens": 2147483648}\ntext("ok")'),
        ).toThrow("no greater than 2147483647");
    });
});
