import { describe, expect, it } from "vitest";

import { modelOpenaiGpt56Terra } from "./models.js";
import { createBedrockProvider } from "./bedrock.js";
import { createCodexProvider } from "./codex.js";
import { createEncryptedAgentTransportScope } from "./createEncryptedAgentTransportScope.js";

describe("createEncryptedAgentTransportScope", () => {
    it("scopes native ciphertext to one provider instance and Bedrock region", () => {
        const cloud = createCodexProvider({ apiKey: "test-token", id: "codex" });
        const bedrockEast = createBedrockProvider({
            bearerToken: "test-token",
            id: "bedrock",
            region: "us-east-1",
        });
        const bedrockEastAgain = createBedrockProvider({
            bearerToken: "test-token",
            id: "bedrock",
            region: "us-east-1",
        });
        const bedrockWest = createBedrockProvider({
            bearerToken: "test-token",
            id: "bedrock",
            region: "us-west-2",
        });
        const otherBedrockAccount = createBedrockProvider({
            bearerToken: "test-token",
            id: "other-bedrock",
            region: "us-east-1",
        });
        const modelFor = (provider: typeof cloud) => {
            const model = provider.models.find(
                (candidate) => candidate.id === modelOpenaiGpt56Terra.id,
            );
            if (model === undefined) throw new Error("Expected GPT-5.6 Terra in test provider.");
            return model;
        };

        const cloudScope = createEncryptedAgentTransportScope(cloud, modelFor(cloud));
        const eastScope = createEncryptedAgentTransportScope(bedrockEast, modelFor(bedrockEast));

        expect(eastScope).toBe(
            createEncryptedAgentTransportScope(bedrockEastAgain, modelFor(bedrockEastAgain)),
        );
        expect(eastScope).not.toBe(cloudScope);
        expect(eastScope).not.toBe(
            createEncryptedAgentTransportScope(bedrockWest, modelFor(bedrockWest)),
        );
        expect(eastScope).not.toBe(
            createEncryptedAgentTransportScope(otherBedrockAccount, modelFor(otherBedrockAccount)),
        );
    });
});
