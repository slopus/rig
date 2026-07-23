import { describe, expect, it } from "vitest";

import { modelAnthropicSonnet46 } from "@slopus/rig-execution";
import { defineProvider } from "@slopus/rig-execution";
import { selectCollaborationToolsForModel } from "./selectCollaborationToolsForModel.js";

describe("selectCollaborationToolsForModel", () => {
    it("selects profile-owned Claude collaboration tools", () => {
        const claude = defineProvider({
            id: "claude",
            models: [modelAnthropicSonnet46],
            type: "claude",
            stream: () => {
                throw new Error("Inference is not used by this test.");
            },
        });
        expect(
            selectCollaborationToolsForModel({
                model: modelAnthropicSonnet46,
                provider: claude,
            }).map((tool) => tool.name),
        ).toEqual(["Agent", "Workflow", "WaitForWorkflow", "SendMessage"]);
    });
});
