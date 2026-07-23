import { describe, expect, it } from "vitest";

import { builtinModelProfiles } from "@/builtinModelProfiles.js";

describe("builtinModelProfiles", () => {
    it("preserves each Grok model's supported default effort", () => {
        const profiles = builtinModelProfiles("grok", "grok");

        expect(
            profiles.find((profile) => profile.id === "xai/grok-composer-2.5-fast")?.defaultEffort,
        ).toBe("off");
        expect(profiles.find((profile) => profile.id === "xai/grok-4.5")?.defaultEffort).toBe(
            "high",
        );
        expect(
            profiles.find((profile) => profile.id === "xai/grok-build")?.defaultEffort,
        ).toBeUndefined();
    });
});
