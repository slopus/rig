import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const validPng32Base64 =
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAARklEQVRIDe3SsQkAMAwDQQVcZP9ZMmDwBF+pe+NS2HDoJO8mvZ293RwfoK5EEqEABmyRRCiAAVskEQpgwBZJhAIYsEVI9AH7IAMiyextiAAAAABJRU5ErkJggg==";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("invalid image recovery after parallel tools", () => {
    it("replaces the image while preserving its text-only sibling and retries", async () => {
        const gym = await createGym({
            files: { "tiny.png": Buffer.from(validPng32Base64, "base64") },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { detail: "original", path: "/workspace/tiny.png" },
                                id: "parallel-image",
                                name: "view_image",
                                type: "toolCall",
                            },
                            {
                                arguments: { cmd: "printf 'PARALLEL_TEXT_RESULT\\n'" },
                                id: "parallel-text",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                const results = request.context.messages.filter(
                    (message) => message.role === "toolResult",
                );
                const imageResult = results.find((message) => message.toolName === "view_image");
                const textResult = results.find((message) => message.toolName === "exec_command");
                expect(
                    textResult === undefined ? "" : JSON.stringify(textResult.content),
                ).toContain("PARALLEL_TEXT_RESULT");

                if (callIndex === 1) {
                    expect(imageResult).toMatchObject({
                        content: [
                            {
                                data: validPng32Base64,
                                mimeType: "image/png",
                                type: "image",
                            },
                        ],
                        isError: false,
                    });
                    return {
                        body: "The image data does not represent a valid image.",
                        httpStatus: 400,
                    };
                }

                expect(callIndex).toBe(2);
                expect(imageResult).toMatchObject({
                    content: [{ text: "Invalid image", type: "text" }],
                    isError: false,
                });
                expect(JSON.stringify(request.context.messages)).not.toContain(validPng32Base64);
                return {
                    content: [{ text: "PARALLEL_IMAGE_RECOVERY_COMPLETE", type: "text" }],
                };
            },
        });
        running.add(gym);

        submit(gym, "Inspect the image and run the text command in parallel.");

        const completed = await gym.terminal.waitForText(
            "PARALLEL_IMAGE_RECOVERY_COMPLETE",
            30_000,
        );
        expect(completed.text).toContain("Ask Rig to do anything");
        expect(completed.text).not.toContain("does not represent a valid image");
        expect(agentRequests(gym)).toHaveLength(3);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function agentRequests(gym: Gym): Gym["inference"]["requests"] {
    return gym.inference.requests.filter(
        (request) => request.options.sessionId?.endsWith(":title") !== true,
    );
}
