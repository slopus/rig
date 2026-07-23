import { describe, expect, it } from "vitest";

import { ResponsesSession } from "@/responses/ResponsesSession.js";

describe("SessionCompaction", () => {
    it("returns a structural completed result", async () => {
        const session = new ResponsesSession("session", {
            context: {
                instructions: "System prompt.",
                messages: [{ role: "system", content: "Preserved metadata." }],
            },
        });
        for await (const _event of session.run({
            context: {
                messages: [{ role: "user", content: "Keep this state." }],
            },
        })) {
            // Drain the session.
        }

        const result = await session.compact();

        expect(result).toEqual({
            status: "completed",
            summary: "Keep this state.",
            preservedMessages: [{ role: "system", content: "Preserved metadata." }],
            context: {
                instructions: "System prompt.",
                messages: [
                    { role: "system", content: "Preserved metadata." },
                    {
                        role: "user",
                        content:
                            "<conversation_summary>\nKeep this state.\n</conversation_summary>",
                    },
                ],
            },
        });
    });

    it("returns cancellation separately and leaves context untouched", async () => {
        const context = {
            instructions: "System prompt.",
            messages: [{ role: "user" as const, content: "Original state." }],
        };
        const session = new ResponsesSession("session", { context });
        const controller = new AbortController();
        controller.abort();

        await expect(session.compact({ signal: controller.signal })).resolves.toEqual({
            status: "cancelled",
            context,
        });
    });
});
