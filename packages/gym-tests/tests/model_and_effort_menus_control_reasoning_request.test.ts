import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("model and effort menus control reasoning requests", () => {
    it("supports cancel and selection while sending the chosen effort to inference", async () => {
        const gym = await createGym({
            cols: 88,
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                const userText =
                    typeof lastMessage?.content === "string"
                        ? lastMessage.content
                        : (lastMessage?.content ?? [])
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join("");
                expect(request.modelId).toBe("openai/gym");
                expect(request.options.thinking).toBe("high");

                if (callIndex === 0) {
                    expect(lastMessage).toMatchObject({ role: "user" });
                    expect(userText).toContain("Use the selected reasoning level.");
                    return {
                        content: [{ text: "HIGH_REASONING_REQUEST_ACCEPTED", type: "text" }],
                    };
                }

                expect(callIndex).toBe(1);
                expect(lastMessage).toMatchObject({ role: "user" });
                expect(userText).toContain("Confirm the selected reasoning persists.");
                return {
                    content: [{ text: "HIGH_REASONING_FOLLOW_UP_ACCEPTED", type: "text" }],
                };
            },
            rows: 24,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("/model");
        gym.terminal.press("enter");
        const modelMenu = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("Choose Model") && snapshot.scroll.atBottom,
            "model menu",
        );
        expect(modelMenu.rows).toHaveLength(24);
        expect(modelMenu.text).toContain("Gym");
        expect(modelMenu.text).toContain("Current model");
        expect(modelMenu.text).toContain("Default reasoning: Off");
        expect(modelMenu.text).toContain("Enter selects, Esc cancels");
        expect(modelMenu.text).not.toContain("openai/gym");
        expect(modelMenu.text).not.toContain("�");
        expect(modelMenu.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(modelMenu.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.press("escape");
        const modelCancelled = await gym.terminal.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("Choose Model") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.scroll.atBottom,
            "model menu cancellation",
        );
        expect(modelCancelled.text).not.toContain("Model changed");
        expect(modelCancelled.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(modelCancelled.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.type("/model");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Choose Model");
        gym.terminal.press("enter");
        const modelReasoningMenu = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("Choose Reasoning") && snapshot.scroll.atBottom,
            "reasoning menu reached from the model menu",
        );
        expect(modelReasoningMenu.text).toContain("Gym");
        expect(modelReasoningMenu.text).toContain("Off");
        expect(modelReasoningMenu.text).toContain("Low");
        expect(modelReasoningMenu.text).toContain("Medium");
        expect(modelReasoningMenu.text).toContain("High");
        expect(modelReasoningMenu.text).toContain("Skip reasoning for fast, direct replies.");
        expect(modelReasoningMenu.text).toContain("Use light reasoning for simple coding tasks.");
        expect(modelReasoningMenu.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(modelReasoningMenu.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.press("down");
        gym.terminal.press("enter");
        const lowSelected = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Reasoning changed to Low.") &&
                snapshot.text.includes("gym low · /workspace") &&
                snapshot.scroll.atBottom,
            "Low reasoning selected through the model menu",
        );
        expect(lowSelected.text).not.toContain("reasoning low");
        expect(lowSelected.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(lowSelected.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.type("/effort");
        gym.terminal.press("enter");
        const effortMenu = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("Choose Reasoning") && snapshot.scroll.atBottom,
            "effort menu",
        );
        expect(effortMenu.text).toContain("→ Low");
        expect(effortMenu.text).toContain("Current level.");
        gym.terminal.press("down");
        gym.terminal.press("escape");
        const effortCancelled = await gym.terminal.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("Choose Reasoning") &&
                snapshot.text.includes("gym low · /workspace") &&
                snapshot.scroll.atBottom,
            "effort menu cancellation",
        );
        expect(effortCancelled.text).not.toContain("Reasoning changed to Medium.");
        expect(effortCancelled.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(effortCancelled.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.type("/effort");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Choose Reasoning");
        gym.terminal.press("down");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        const highSelected = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Reasoning changed to High.") &&
                snapshot.text.includes("gym high · /workspace") &&
                snapshot.scroll.atBottom,
            "High reasoning selection",
        );
        expect(highSelected.text).not.toContain("reasoning high");
        expect(highSelected.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(highSelected.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.type("Use the selected reasoning level.");
        gym.terminal.press("enter");
        const response = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("HIGH_REASONING_REQUEST_ACCEPTED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym high · /workspace") &&
                snapshot.scroll.atBottom,
            "response using High reasoning",
            30_000,
        );
        expect(response.rows).toHaveLength(24);
        expect(response.scroll.visibleRows).toBe(24);
        expect(response.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(response.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(response.text).not.toContain("�");
        expect(response.cursor.x).toBeLessThan(88);
        expect(response.cursor.y).toBeLessThan(24);

        gym.terminal.type("Confirm the selected reasoning persists.");
        gym.terminal.press("enter");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("HIGH_REASONING_FOLLOW_UP_ACCEPTED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym high · /workspace") &&
                snapshot.scroll.atBottom,
            "follow-up with persistent High reasoning",
            30_000,
        );
        expect(followUp.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(followUp.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(followUp.text).not.toContain("�");

        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(agentRequests).toHaveLength(2);
        expect(agentRequests.every((request) => request.options.thinking === "high")).toBe(true);
        expect(agentRequests.every((request) => request.modelId === "openai/gym")).toBe(true);
    }, 120_000);
});
