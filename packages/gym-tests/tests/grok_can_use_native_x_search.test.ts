import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Grok native X search", () => {
    it("delegates Rig's x_search tool to Grok 4.5", async () => {
        const gym = await createGym({
            environment: {
                DISABLE_TELEMETRY: "1",
                XAI_API_KEY: "test-only-placeholder",
            },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    expect(request.providerId).toBe("gym");
                    expect(request.context.tools?.map((tool) => tool.name)).toContain("x_search");
                    return {
                        content: [
                            {
                                arguments: { query: "recent posts from the xAI account" },
                                id: "x-search-1",
                                name: "x_search",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(request.providerId).toBe("grok");
                    expect(request.modelId).toBe("xai/grok-4.5");
                    expect(request.context).toMatchObject({
                        serverTools: [expect.objectContaining({ type: "x_search" })],
                    });
                    return {
                        content: [
                            {
                                text: "A recent result: https://x.com/xai/status/123",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(request.providerId).toBe("gym");
                expect(request.context.messages.at(-1)).toMatchObject({
                    role: "toolResult",
                    toolName: "x_search",
                    isError: false,
                });
                return { content: [{ text: "Found it.", type: "text" }] };
            },
            providerOverrides: ["grok"],
        });
        running.add(gym);

        gym.terminal.type("Find a recent post from xAI on X.");
        gym.terminal.press("enter");

        const screen = await gym.terminal.waitForText("Found it.", 30_000);
        expect(screen.text).toContain("Found it.");
    }, 40_000);
});
