import { describe, expect, it } from "vitest";

import { createGymProviderFromEnvironment } from "./createGymProviderFromEnvironment.js";

describe("createGymProviderFromEnvironment", () => {
    it("returns no provider without a configured endpoint", () => {
        expect(createGymProviderFromEnvironment({})).toBeUndefined();
        expect(createGymProviderFromEnvironment({ RIG_GYM_INFERENCE_URL: "   " })).toBeUndefined();
    });

    it("applies the shared Gym environment configuration", () => {
        const provider = createGymProviderFromEnvironment({
            RIG_GYM_CONTEXT_WINDOW: "123456",
            RIG_GYM_INFERENCE_URL: "https://gym.test/inference",
            RIG_GYM_TOKEN: "gym-token",
        });

        expect(provider).toBeDefined();
        expect(provider?.id).toBe("gym");
        expect(provider?.models[0]?.contextWindow).toBe(123_456);
    });
});
