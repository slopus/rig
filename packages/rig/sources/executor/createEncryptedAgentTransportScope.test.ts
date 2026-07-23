import { describe, expect, it } from "vitest";

import { modelOpenaiGpt56Terra } from "@slopus/rig-execution";
import { bedrockExecution } from "./bedrockExecution.js";
import { createEncryptedAgentTransportScope } from "./createEncryptedAgentTransportScope.js";
import { defineProvider, Executor } from "@slopus/rig-execution";

describe("createEncryptedAgentTransportScope", () => {
    it("scopes native ciphertext to each compatible executor provider", () => {
        const cloud = defineProvider({
            id: "codex",
            type: "codex",
            models: [modelOpenaiGpt56Terra],
            stream: () => {
                throw new Error("Inference is not used by this test.");
            },
        });
        const bedrockEast = new Executor([
            bedrockExecution({
                bearerToken: "test-token",
                id: "bedrock",
                region: "us-east-1",
            }),
        ]);
        const modelFor = (provider: typeof cloud) => {
            const model = provider.models.find(
                (candidate) => candidate.id === modelOpenaiGpt56Terra.id,
            );
            if (model === undefined) throw new Error("Expected GPT-5.6 Terra in test provider.");
            return model;
        };

        const cloudScope = createEncryptedAgentTransportScope(cloud, modelFor(cloud));
        const eastScope = createEncryptedAgentTransportScope(bedrockEast, modelFor(bedrockEast));

        expect(cloudScope).toBe("codex");
        expect(eastScope).toBeUndefined();
    });
});
