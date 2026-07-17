import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("large multiline Unicode message renders without corruption", () => {
    it("keeps the terminal stable during a deterministic fuzzy multiline write", async () => {
        const message = createFuzzyMessage(1_000);
        const expectedMessage = message.replaceAll("\t", "    ").trim();
        const gym = await createGym({
            cols: 88,
            inference(request, callIndex) {
                const userMessage = [...request.context.messages]
                    .reverse()
                    .find((candidate) => candidate.role === "user");
                const received =
                    typeof userMessage?.content === "string"
                        ? userMessage.content
                        : (userMessage?.content ?? [])
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join("");
                if (callIndex === 0 && received !== expectedMessage) {
                    return {
                        body: `Large message changed in transit: expected ${expectedMessage.length} characters, received ${received.length}.`,
                        httpStatus: 422,
                    };
                }
                return {
                    content: [
                        {
                            text:
                                callIndex === 0 ? "FUZZ_MESSAGE_ACCEPTED" : "SECOND_TURN_ACCEPTED",
                            type: "text",
                        },
                    ],
                };
            },
            rows: 34,
        });
        running.add(gym);
        const initialScroll = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type(message);
        const editing = await gym.terminal.waitForText("[paste #", 30_000);
        expect(editing.text).toContain("gym off · /workspace");
        assertViewportStayedAtBottom(editing, initialScroll);
        gym.terminal.press("enter");

        const firstTurn = await gym.terminal.waitForText("FUZZ_MESSAGE_ACCEPTED", 30_000);
        assertHealthyTerminal(firstTurn, initialScroll);

        gym.terminal.type("Verify the terminal still accepts input.");
        gym.terminal.press("enter");
        const secondTurn = await gym.terminal.waitForText("SECOND_TURN_ACCEPTED", 30_000);
        assertHealthyTerminal(secondTurn, initialScroll);
    }, 60_000);
});

function createFuzzyMessage(lineCount: number): string {
    const fragments = [
        "plain ASCII with  repeated   spaces",
        "\tindented with tabs\tand a tail",
        "日本語の幅広文字と 한국어와 中文字符",
        "emoji 👩🏽‍💻 🧪 🚀 family 👨‍👩‍👧‍👦 flags 🇩🇯🇺🇳",
        "combining e\u0301 a\u0308 n\u0303 and Devanagari नमस्ते",
        "العربية من اليمين إلى اليسار — עברית",
        "math ∀x∈ℝ: x² ≥ 0; arrows ← ↔ →; box ┌─┬─┐",
        "long-word-" + "abcdef0123456789".repeat(14),
        "",
        "        leading and trailing whitespace        ",
    ] as const;
    const lines = Array.from({ length: lineCount }, (_, index) => {
        const fragment = fragments[(index * 17 + 3) % fragments.length] ?? "";
        return `${String(index).padStart(4, "0")} ${fragment}`;
    });
    lines.splice(37, 0, "", "   ", "\t\t");
    return `  FUZZ_BEGIN\n${lines.join("\n")}\nFUZZ_END  `;
}

function assertHealthyTerminal(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    initialScroll: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(34);
    expect(snapshot.text).toContain("Ask Rig to do anything");
    expect(snapshot.text).toContain("gym off · /workspace");
    expect(snapshot.text).not.toContain("\x1b[200~");
    expect(snapshot.text).not.toContain("\x1b[201~");
    expect(snapshot.text).not.toContain("�");
    assertViewportStayedAtBottom(snapshot, initialScroll);
}

function assertViewportStayedAtBottom(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    initialScroll: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(initialScroll.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(initialScroll.topArrivalCount);
}
