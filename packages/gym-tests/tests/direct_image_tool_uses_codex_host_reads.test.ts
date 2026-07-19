import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("direct image tools use Codex-style host reads", () => {
    it("applies the same host-readable boundary as the shell sandbox", async () => {
        let stage = 0;
        const gym = await createGym({
            mode: "docker",
            homeFiles: {
                ".config/reference.png": Buffer.from(PNG_BASE64, "base64"),
            },
            inference(request) {
                const lastMessage = request.context.messages.at(-1);
                if (stage === 0) {
                    stage = 1;
                    return {
                        content: [
                            {
                                arguments: { path: "/home/rig/.config/reference.png" },
                                id: "read-host-image",
                                name: "view_image",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (stage === 1) {
                    stage = 2;
                    const content = Array.isArray(lastMessage?.content) ? lastMessage.content : [];
                    const imageReachedModel = content.some((block) => block.type === "image");
                    return {
                        content: [
                            {
                                text: imageReachedModel
                                    ? "DIRECT_HOST_IMAGE_READ_OK"
                                    : "DIRECT_HOST_IMAGE_READ_FAILED",
                                type: "text",
                            },
                        ],
                    };
                }
                return { content: [{ text: "DIRECT_READ_FOLLOW_UP_OK", type: "text" }] };
            },
            permissionMode: "workspace_write",
        });
        running.add(gym);

        submit(gym, "Inspect the configured host reference image.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                (snapshot.text.includes("DIRECT_HOST_IMAGE_READ_OK") ||
                    snapshot.text.includes("DIRECT_HOST_IMAGE_READ_FAILED")) &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the direct host image read outcome",
            30_000,
        );
        expect(outcome.text).toContain("DIRECT_HOST_IMAGE_READ_OK");
        expect(outcome.text).not.toContain("DIRECT_HOST_IMAGE_READ_FAILED");

        submit(gym, "Confirm the restricted session remains usable.");
        await gym.terminal.waitForText("DIRECT_READ_FOLLOW_UP_OK", 30_000);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
