import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("streamed tool-call activity", () => {
    it("renders one live Working row and removes its placeholder after interruption", async () => {
        const gym = await createGym({
            inference: [
                {
                    content: [
                        { text: "STREAMED_CALL_STARTED", type: "text" },
                        {
                            arguments: { cmd: "printf 'should not run\\n'" },
                            id: "streamed-tool-call",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                    toolCallDeltaDelayMs: 30_000,
                },
                { content: [{ text: "RECOVERED_AFTER_STREAM_INTERRUPT", type: "text" }] },
            ],
        });
        running.add(gym);

        gym.terminal.type("Begin a streamed tool call.");
        gym.terminal.press("enter");

        const streaming = await gym.terminal.waitForText("STREAMED_CALL_STARTED", 30_000);
        expect(streaming.text.match(/Working/gu)).toHaveLength(1);
        expect(streaming.text).toContain("esc to interrupt");

        gym.terminal.press("escape");
        const interrupted = await gym.terminal.waitForText("Session interrupted", 30_000);
        expect(interrupted.text).not.toContain("Working");
        expect(interrupted.text).not.toContain("should not run");

        gym.terminal.type("Confirm recovery.");
        gym.terminal.press("enter");
        const recovered = await gym.terminal.waitForText(
            "RECOVERED_AFTER_STREAM_INTERRUPT",
            30_000,
        );
        expect(recovered.text).not.toContain("Working");
    }, 90_000);
});
