import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("standalone conversation compaction transport retries", () => {
    it("recovers when the summary request disconnects before content", async () => {
        const gym = await createGym({
            inference(request, callIndex) {
                const isCompaction = request.context.systemPrompt?.startsWith(
                    "Create a detailed continuation brief",
                );
                if (callIndex === 0) {
                    expect(isCompaction).toBe(false);
                    return { content: [{ text: "Initial work completed.", type: "text" }] };
                }
                if (callIndex === 1) {
                    expect(isCompaction).toBe(true);
                    return { disconnect: true };
                }
                expect(callIndex).toBe(2);
                expect(isCompaction).toBe(true);
                return { content: [{ text: "Recovered standalone summary.", type: "text" }] };
            },
        });
        running.add(gym);

        submit(gym, "Complete one turn before compacting.");
        await gym.terminal.waitForText("Initial work completed.", 30_000);
        submit(gym, "/compact");

        const compacted = await gym.terminal.waitForText("Compacted 2 older messages", 30_000);
        expect(compacted.text).not.toContain("fetch failed");
        expect(agentRequests(gym)).toHaveLength(3);
        expect(agentRequests(gym).slice(1).every(isCompactionRequest)).toBe(true);
    }, 120_000);

    it("does not retry after standalone summary text begins", async () => {
        const gym = await createGym({
            inference(request, callIndex) {
                const isCompaction = isCompactionRequest(request);
                if (callIndex === 0) {
                    expect(isCompaction).toBe(false);
                    return { content: [{ text: "Initial work completed.", type: "text" }] };
                }
                if (callIndex === 1) {
                    expect(isCompaction).toBe(true);
                    return {
                        content: [{ text: "PARTIAL_STANDALONE_SUMMARY", type: "text" }],
                        errorMessage: "WebSocket error",
                        stopReason: "error",
                    };
                }
                return { content: [{ text: "FORBIDDEN_COMPACTION_REPLAY", type: "text" }] };
            },
        });
        running.add(gym);

        submit(gym, "Complete one turn before compacting.");
        await gym.terminal.waitForText("Initial work completed.", 30_000);
        submit(gym, "/compact");

        const failed = await gym.terminal.waitForText("WebSocket error", 30_000);
        expect(failed.text).not.toContain("FORBIDDEN_COMPACTION_REPLAY");
        expect(agentRequests(gym)).toHaveLength(2);
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

function isCompactionRequest(request: Gym["inference"]["requests"][number]): boolean {
    return (
        request.context.systemPrompt?.startsWith("Create a detailed continuation brief") === true
    );
}
