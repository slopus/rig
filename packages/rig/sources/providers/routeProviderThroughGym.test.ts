import { describe, expect, it, vi } from "vitest";

import { defineModel, defineProvider } from "./types.js";
import { routeProviderThroughGym } from "./routeProviderThroughGym.js";

describe("routeProviderThroughGym", () => {
    it("keeps native quota reads while routing inference through Gym", async () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gym-routed",
            name: "Gym routed",
            thinkingLevels: ["off"],
        });
        const quota = vi.fn(async () => ({
            capturedAt: 1,
            source: "codex" as const,
            windows: {
                fiveHour: { status: "unavailable" as const },
                weekly: { status: "unavailable" as const },
            },
        }));
        const native = defineProvider({
            contextCompatibility: "model_group",
            contextCompatibilityKind: "claude_code",
            contextCompatibilityKey: () => "us-east-1",
            id: "codex",
            imageProfile: () => "claude",
            models: [model],
            quota,
            toolProfile: () => "grok",
            stream: () => {
                throw new Error("Native inference should be replaced.");
            },
        });

        const routed = routeProviderThroughGym(native, {
            RIG_GYM_INFERENCE_URL: "https://gym.test/inference",
            RIG_GYM_PROVIDER_OVERRIDES: "codex",
        });

        await routed.quota?.({ fresh: true });
        expect(quota).toHaveBeenCalledWith({ fresh: true });
        expect(routed.id).toBe("codex");
        expect(routed.contextCompatibility).toBe("model_group");
        expect(routed.contextCompatibilityKind).toBe("claude_code");
        expect(routed.contextCompatibilityKey?.(model)).toBe("us-east-1");
        expect(routed.imageProfile(model)).toBe("claude");
        expect(routed.toolProfile(model)).toBe("grok");
        expect(routed.models).toEqual([model]);
    });
});
