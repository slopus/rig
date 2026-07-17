import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 86;
const ROWS = 24;
const running = new Set<Gym>();
const validPng32Base64 =
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAARklEQVRIDe3SsQkAMAwDQQVcZP9ZMmDwBF+pe+NS2HDoJO8mvZ293RwfoK5EEqEABmyRRCiAAVskEQpgwBZJhAIYsEVI9AH7IAMiyextiAAAAABJRU5ErkJggg==";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("view_image reads a real PNG and returns an image to the model", () => {
    it("decodes fixture bytes, renders a readable tool result, and accepts a follow-up", async () => {
        const gym = await createGym({
            cols: COLS,
            files: {
                "tiny.png": Buffer.from(validPng32Base64, "base64"),
            },
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                if (callIndex === 0) {
                    expect(lastMessage).toMatchObject({ role: "user" });
                    return {
                        content: [
                            {
                                arguments: {
                                    detail: "original",
                                    path: "/workspace/tiny.png",
                                },
                                id: "view-real-png",
                                name: "view_image",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        content: [
                            {
                                data: validPng32Base64,
                                detail: "original",
                                mimeType: "image/png",
                                type: "image",
                            },
                        ],
                        isError: false,
                        role: "toolResult",
                        toolCallId: "view-real-png",
                        toolName: "view_image",
                    });
                    return {
                        content: [
                            {
                                text: "IMAGE_VIEW_COMPLETE: decoded a 32 by 32 PNG.",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(lastMessage).toMatchObject({ role: "user" });
                expect(JSON.stringify(request.context.messages)).toContain(validPng32Base64);
                return { content: [{ text: "IMAGE_FOLLOW_UP_ACCEPTED", type: "text" }] };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "View the real tiny PNG with original detail.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("IMAGE_VIEW_COMPLETE: decoded a 32 by 32 PNG.") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the decoded image result and idle composer",
            30_000,
        );
        assertHealthyTerminal(completed, baseline);
        expect(completed.text).toContain("Read /workspace/tiny.png");
        expect(completed.text).toContain("└ Viewed /workspace/tiny.png");
        expect(completed.text).not.toContain("view_image");
        expect(completed.text).not.toContain(validPng32Base64.slice(0, 24));

        submit(gym, "Confirm the image remains available in conversation context.");
        const followUp = await gym.terminal.waitForText("IMAGE_FOLLOW_UP_ACCEPTED", 30_000);
        assertHealthyTerminal(followUp, baseline);
        expect(followUp.text).toContain("Ask Rig to do anything");

        const requests = agentRequests(gym);
        expect(requests).toHaveLength(3);
        expect(requests[1]?.context.messages.at(-1)).toMatchObject({
            content: [
                {
                    data: validPng32Base64,
                    detail: "original",
                    mimeType: "image/png",
                    type: "image",
                },
            ],
            isError: false,
            role: "toolResult",
            toolName: "view_image",
        });
    }, 60_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    );
}

function assertHealthyTerminal(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(ROWS);
    expect(snapshot.scroll.visibleRows).toBe(ROWS);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(COLS);
    expect(snapshot.cursor.y).toBeLessThan(ROWS);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
}
