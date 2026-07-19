import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("available model guidance", () => {
    it("tells the agent which configured models it can run as subagents", async () => {
        const gym = await createGym({
            environment: { NODE_OPTIONS: "--experimental-transform-types" },
            inference(request) {
                const systemPrompt = request.context.systemPrompt;
                expect(systemPrompt).toContain("# Available models");
                expect(systemPrompt).toContain("- claude: Sonnet 5 (`anthropic/sonnet-5`)");
                expect(systemPrompt).toContain("- claude: Opus 4.8 1M (`anthropic/opus-4-8`)");
                expect(systemPrompt).toContain("- codex: GPT-5.6 Sol (`openai/gpt-5.6-sol`)");
                expect(systemPrompt).toContain("bare model or family name");
                expect(systemPrompt).toContain("spawn a subagent");
                expect(systemPrompt).toContain("without asking for confirmation");
                return { content: [{ text: "MODEL_GUIDANCE_OK", type: "text" }] };
            },
        });
        running.add(gym);

        gym.terminal.type("Confirm the available model guidance.");
        gym.terminal.press("enter");

        const result = await gym.terminal.waitForText("MODEL_GUIDANCE_OK", 30_000);
        expect(result.text).toContain("MODEL_GUIDANCE_OK");
    });
});
