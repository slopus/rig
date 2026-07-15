import { describe, expect, it } from "vitest";

import { orderMessagesByEventSequence } from "./orderMessagesByEventSequence.js";

describe("orderMessagesByEventSequence", () => {
    it("places repaired messages by event chronology while preserving unknown slots", () => {
        expect(
            orderMessagesByEventSequence(
                [
                    { messageId: "unknown" },
                    { messageId: "later" },
                    { messageId: "orphan", variant: "rich" },
                    { messageId: "orphan", variant: "duplicate" },
                ],
                [{ messageId: "orphan" }, { messageId: "middle" }, { messageId: "middle" }],
                new Map([
                    ["orphan", 2],
                    ["middle", 4],
                    ["later", 6],
                ]),
            ),
        ).toEqual([
            { messageId: "unknown" },
            { messageId: "orphan", variant: "rich" },
            { messageId: "middle" },
            { messageId: "later" },
        ]);
    });
});
