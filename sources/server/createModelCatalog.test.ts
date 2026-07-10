import { describe, expect, it } from "vitest";

import {
    modelMoonshotKimiK25,
    modelOpenaiGpt55,
    modelOpenaiGpt56Sol,
    modelZaiGlm5,
} from "../providers/models.js";
import { createModelCatalog } from "./createModelCatalog.js";

describe("createModelCatalog", () => {
    it("does not expose Amazon Bedrock without a bearer token", () => {
        const catalog = createModelCatalog({ env: {} });

        expect(catalog.providers.map((provider) => provider.providerId)).not.toContain("bedrock");
    });

    it("enables Amazon Bedrock when its bearer token is present", () => {
        const catalog = createModelCatalog({
            env: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
                AWS_REGION: "us-east-1",
            },
        });

        const codex = catalog.providers.find((provider) => provider.providerId === "codex");
        const bedrock = catalog.providers.find((provider) => provider.providerId === "bedrock");
        expect(catalog.defaultProviderId).toBe("codex");
        expect(catalog.defaultModelId).toBe(modelOpenaiGpt56Sol.id);
        expect(codex?.models).toContain(modelOpenaiGpt56Sol);
        expect(codex?.models).toContain(modelOpenaiGpt55);
        expect(bedrock?.models).toContain(modelOpenaiGpt55);
        expect(bedrock?.models).toContain(modelMoonshotKimiK25);
        expect(bedrock?.models).toContain(modelZaiGlm5);
        expect(catalog.models.filter((model) => model.id === modelOpenaiGpt55.id)).toEqual([
            modelOpenaiGpt55,
        ]);
    });

    it("treats a blank bearer token as absent", () => {
        const catalog = createModelCatalog({
            env: { AWS_BEARER_TOKEN_BEDROCK: "   " },
        });

        expect(catalog.providers.map((provider) => provider.providerId)).not.toContain("bedrock");
    });
});
