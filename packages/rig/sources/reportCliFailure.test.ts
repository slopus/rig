import { afterEach, describe, expect, it, vi } from "vitest";

import { reportCliFailure } from "./reportCliFailure.js";

afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe("reportCliFailure", () => {
    it("prints a concise user-facing message without an error stack", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const failure = new Error("The configured provider is unavailable.");

        reportCliFailure(failure);

        expect(error).toHaveBeenCalledWith(
            "Rig could not start: The configured provider is unavailable.",
        );
        expect(error.mock.calls[0]?.[0]).not.toContain(failure.stack);
        expect(process.exitCode).toBe(1);
    });
});
