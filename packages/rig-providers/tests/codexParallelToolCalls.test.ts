import { describe, expect, it } from "vitest";

import { createCodexCliRequest } from "@/vendors/codex/impl/createCodexCliRequest.js";
import { createCodexRequestHeaders } from "@/vendors/codex/impl/createCodexRequestHeaders.js";
import { stampCodexWebSocketRequest } from "@/vendors/codex/impl/stampCodexWebSocketRequest.js";

describe("Codex parallel tool calls", () => {
    it.each([
        ["gpt-5.5", true],
        ["gpt-5.6-sol", false],
    ] as const)("preserves the native default for %s", (model, expected) => {
        const request = createCodexCliRequest({
            clientMetadata: {},
            context: { instructions: "Test", messages: [] },
            effort: "low",
            model,
            promptCacheKey: "session",
            skills: [],
            tools: [],
        });

        expect(request.parallel_tool_calls).toBe(expected);
    });

    it.each([
        ["gpt-5.5", false],
        ["gpt-5.6-sol", true],
    ] as const)("allows the provider to override %s", (model, parallelToolCalls) => {
        const request = createCodexCliRequest({
            clientMetadata: {},
            context: { instructions: "Test", messages: [] },
            effort: "low",
            model,
            parallelToolCalls,
            promptCacheKey: "session",
            skills: [],
            tools: [],
        });

        expect(request.parallel_tool_calls).toBe(parallelToolCalls);
    });

    it("uses the standard Codex v2 contract when parallel calls are enabled", () => {
        const request = createCodexCliRequest({
            clientMetadata: {},
            context: { instructions: "Test", messages: [] },
            effort: "low",
            model: "gpt-5.6-sol",
            parallelToolCalls: true,
            promptCacheKey: "session",
            skills: [],
            tools: [],
        });

        expect(request).toMatchObject({
            instructions: "Test",
            parallel_tool_calls: true,
            tools: [],
        });
        expect(request.input).toEqual([]);
        expect(request.reasoning).not.toHaveProperty("context");
        expect(stampCodexWebSocketRequest(request).client_metadata).not.toHaveProperty(
            "ws_request_header_x_openai_internal_codex_responses_lite",
        );
        expect(
            createCodexRequestHeaders("gpt-5.6-sol", undefined, "window", undefined, false),
        ).not.toHaveProperty("x-openai-internal-codex-responses-lite");
    });
});
