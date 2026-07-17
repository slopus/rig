import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const VALID_PNG_32_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAARklEQVRIDe3SsQkAMAwDQQVcZP9ZMmDwBF+pe+NS2HDoJO8mvZ293RwfoK5EEqEABmyRRCiAAVskEQpgwBZJhAIYsEVI9AH7IAMiyextiAAAAABJRU5ErkJggg==";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Pi read image attachments", () => {
    it("returns a real PNG to the model as an image block", async () => {
        const gym = await createGym({
            environment: {
                AWS_BEARER_TOKEN_BEDROCK: "gym-placeholder-token",
                RIG_GYM_PROVIDER_OVERRIDES: "bedrock",
            },
            files: {
                "tiny.png": Buffer.from(VALID_PNG_32_BASE64, "base64"),
            },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { path: "/workspace/tiny.png" },
                                id: "pi-read-real-png",
                                name: "read",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(1);
                expect(request.context.messages.at(-1)).toMatchObject({
                    content: [
                        {
                            data: VALID_PNG_32_BASE64,
                            mimeType: "image/png",
                            type: "image",
                        },
                    ],
                    isError: false,
                    role: "toolResult",
                    toolName: "read",
                });
                return { content: [{ text: "PI_READ_IMAGE_VERIFIED", type: "text" }] };
            },
            modelId: "zai/glm-5",
            providerId: "bedrock",
        });
        running.add(gym);

        gym.terminal.type("Read the PNG image.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("PI_READ_IMAGE_VERIFIED", 30_000);
    }, 120_000);
});
