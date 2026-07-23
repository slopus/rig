import { describe, expect, it } from "vitest";

import { modelOpenaiGpt54 } from "@slopus/rig-execution";
import { selectCompactionSystemPromptForModel } from "./selectCompactionSystemPromptForModel.js";

describe("selectCompactionSystemPromptForModel", () => {
    it("uses the standard continuation brief", () => {
        expect(selectCompactionSystemPromptForModel(modelOpenaiGpt54)).toMatch(
            /^Create a detailed continuation brief/u,
        );
    });
});
