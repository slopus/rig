import { describe, expect, it } from "vitest";

import type { Message } from "../../agent/types.js";
import { selectLastUserTurns } from "./selectLastUserTurns.js";

describe("selectLastUserTurns", () => {
    it("keeps complete messages from the last requested user-turn boundary", () => {
        const messages = [
            user("u1"),
            assistant("a1"),
            user("u2"),
            assistant("a2"),
            user("u3"),
            assistant("a3"),
        ];

        expect(selectLastUserTurns(messages, 2)).toEqual(messages.slice(2));
        expect(selectLastUserTurns(messages, 1)).toEqual(messages.slice(4));
        expect(selectLastUserTurns(messages, 10)).toEqual(messages);
        expect(selectLastUserTurns(messages, undefined)).toBe(messages);
    });
});

function user(id: string): Message {
    return { role: "user", id, blocks: [{ type: "text", text: id }] };
}

function assistant(id: string): Message {
    return { role: "agent", id, blocks: [{ type: "text", text: id }] };
}
