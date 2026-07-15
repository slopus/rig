import { describe, expect, it } from "vitest";

import { parseSessionMetadata } from "./generateSessionMetadata.js";

describe("parseSessionMetadata", () => {
    it("accepts only the strict bounded title and recap object", () => {
        expect(
            parseSessionMetadata(
                '{"title":"Delayed session metadata","recap":"The user added delayed metadata. The implementation is complete."}',
            ),
        ).toEqual({
            recap: "The user added delayed metadata. The implementation is complete.",
            title: "Delayed session metadata",
        });

        expect(() => parseSessionMetadata("```json\n{}\n```")).toThrow("invalid JSON");
        expect(() => parseSessionMetadata('{"title":"One","recap":"Valid recap."}')).toThrow(
            "2 to 6 words",
        );
        expect(() =>
            parseSessionMetadata('{"title":"Valid title","recap":"One. Two. Three."}'),
        ).toThrow("at most 2 sentences");
        expect(() =>
            parseSessionMetadata('{"title":"Valid title","recap":"Valid recap.","extra":"no"}'),
        ).toThrow("only string title and recap");
    });
});
