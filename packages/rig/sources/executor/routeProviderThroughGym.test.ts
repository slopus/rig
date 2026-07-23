import { describe, expect, it, vi } from "vitest";

import { defineModel, defineProvider } from "@slopus/rig-execution";
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
        const extendProfilePromptContext = vi.fn((context) => ({
            ...context,
            shell: "/bin/zsh",
        }));
        const close = vi.fn();
        const native = defineProvider({
            close,
            id: "codex",
            extendProfilePromptContext,
            models: [model],
            quota,
            type: "codex",
            stream: () => {
                throw new Error("Native inference should be replaced.");
            },
        });

        const routed = routeProviderThroughGym(native, {
            RIG_GYM_INFERENCE_URL: "https://gym.test/inference",
            RIG_GYM_PROVIDER_OVERRIDES: "codex",
        });

        await routed.quota?.({ fresh: true });
        await routed.close?.();
        expect(quota).toHaveBeenCalledWith({ fresh: true });
        expect(close).toHaveBeenCalledOnce();
        expect(routed.id).toBe("codex");
        expect(routed.type).toBe("codex");
        expect(routed.models).toEqual([model]);
        expect(routed.extendProfilePromptContext).toBe(extendProfilePromptContext);
    });
});
