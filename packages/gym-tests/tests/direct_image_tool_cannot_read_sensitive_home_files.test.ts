import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("direct image tools cannot read sensitive home files", () => {
    it("applies the same credential boundary as the shell sandbox", async () => {
        let stage = 0;
        const gym = await createGym({
            cols: 98,
            homeFiles: {
                ".ssh/identity.png": Buffer.from(PNG_BASE64, "base64"),
            },
            inference(request) {
                if (request.options.sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Sensitive image audit", type: "text" }] };
                }
                const lastMessage = request.context.messages.at(-1);
                if (stage === 0) {
                    stage = 1;
                    return {
                        content: [
                            {
                                arguments: { path: "/home/rig/.ssh/identity.png" },
                                id: "read-sensitive-image",
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
                                text:
                                    lastMessage?.role === "toolResult" &&
                                    lastMessage.isError === true &&
                                    !imageReachedModel
                                        ? "DIRECT_SENSITIVE_IMAGE_READ_BLOCKED"
                                        : "SECURITY_FAILURE_DIRECT_IMAGE_REACHED_MODEL",
                                type: "text",
                            },
                        ],
                    };
                }
                return { content: [{ text: "DIRECT_READ_FOLLOW_UP_OK", type: "text" }] };
            },
            permissionMode: "workspace_write",
            rows: 27,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Inspect ordinary project images only.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                (snapshot.text.includes("DIRECT_SENSITIVE_IMAGE_READ_BLOCKED") ||
                    snapshot.text.includes("SECURITY_FAILURE_DIRECT_IMAGE_REACHED_MODEL")) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the direct sensitive image read outcome",
            30_000,
        );
        expect(outcome.text).toContain("DIRECT_SENSITIVE_IMAGE_READ_BLOCKED");
        expect(outcome.text).not.toContain("SECURITY_FAILURE_DIRECT_IMAGE_REACHED_MODEL");
        expect(outcome.text).toContain("/home/rig/.ssh/identity.png");
        expect(outcome.text).toMatch(/sensitive|credential|blocked/iu);
        assertHealthy(outcome, baseline);

        submit(gym, "Confirm the restricted session remains usable.");
        const followUp = await gym.terminal.waitForText("DIRECT_READ_FOLLOW_UP_OK", 30_000);
        assertHealthy(followUp, baseline);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function assertHealthy(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(27);
    expect(snapshot.scroll.visibleRows).toBe(27);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(98);
    expect(snapshot.cursor.y).toBeLessThan(27);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).toContain("workspace write");
    expect(snapshot.text).not.toContain("�");
}
