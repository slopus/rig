import { describe, expect, it } from "vitest";

import { classifyCodexProviderError } from "./classifyCodexProviderError.js";

describe("classifyCodexProviderError", () => {
    it("classifies the generic request failure as an internal server error", () => {
        expect(
            classifyCodexProviderError(
                "Codex error: An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID a22a6855-605a-4f23-9955-429f689b87c1 in your message.",
            ),
        ).toEqual({
            type: "internal_server_error",
            requestId: "a22a6855-605a-4f23-9955-429f689b87c1",
        });
    });

    it("classifies the explicit capacity failure as server overload", () => {
        expect(
            classifyCodexProviderError(
                "Codex error: Our servers are currently overloaded. Please try again later.",
            ),
        ).toEqual({ type: "server_overloaded" });
    });

    it("leaves unrelated Codex failures unclassified", () => {
        expect(classifyCodexProviderError("Codex returned an unfamiliar failure.")).toEqual({
            type: "unclassified",
        });
    });
});
