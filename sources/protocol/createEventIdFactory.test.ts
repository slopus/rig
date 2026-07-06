import { describe, expect, it } from "vitest";

import { createEventIdFactory } from "./createEventIdFactory.js";

describe("createEventIdFactory", () => {
    it("creates lexicographically time-ordered ids", () => {
        let now = 1_700_000_000_000;
        const createId = createEventIdFactory({ now: () => now });

        const first = createId();
        const second = createId();
        now += 1;
        const third = createId();

        expect([third, first, second].sort()).toEqual([first, second, third]);
        expect(first).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        );
    });
});
