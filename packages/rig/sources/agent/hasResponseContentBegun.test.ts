import { describe, expect, it } from "vitest";

import { hasResponseContentBegun } from "./hasResponseContentBegun.js";
import type { AssistantMessageEvent } from "@slopus/rig-execution";

describe("hasResponseContentBegun", () => {
    it.each([
        "start",
        "done",
        "error",
        "text_start",
        "thinking_start",
    ] satisfies AssistantMessageEvent["type"][])("ignores the structural %s event", (type) => {
        expect(hasResponseContentBegun({ type } as AssistantMessageEvent)).toBe(false);
    });

    it.each(["text_delta", "thinking_delta"] as const)(
        "requires payload bytes in a %s event",
        (type) => {
            expect(hasResponseContentBegun({ type, delta: "" } as AssistantMessageEvent)).toBe(
                false,
            );
            expect(
                hasResponseContentBegun({ type, delta: "content" } as AssistantMessageEvent),
            ).toBe(true);
        },
    );

    it("treats a tool-call start as response content", () => {
        expect(hasResponseContentBegun({ type: "toolcall_start" } as AssistantMessageEvent)).toBe(
            true,
        );
    });
});
