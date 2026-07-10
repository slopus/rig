import { describe, expect, it } from "vitest";

import type { ModelCatalog } from "../protocol/index.js";
import { defineModel } from "../providers/types.js";
import { InMemorySessionStore } from "./InMemorySessionStore.js";

describe("InMemorySession", () => {
    it("routes the same canonical model through the explicitly selected provider", () => {
        const sharedModel = defineModel({
            defaultThinkingLevel: "medium",
            id: "openai/shared",
            name: "Shared model",
            thinkingLevels: ["medium"],
        });
        const bedrockOnlyModel = defineModel({
            defaultThinkingLevel: "off",
            id: "zai/bedrock-only",
            name: "Bedrock-only model",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: sharedModel.id,
            defaultProviderId: "codex",
            models: [sharedModel, bedrockOnlyModel],
            providers: [
                { providerId: "codex", models: [sharedModel] },
                { providerId: "bedrock", models: [sharedModel, bedrockOnlyModel] },
            ],
        };
        const store = new InMemorySessionStore({ modelCatalog: catalog });

        const session = store.create({
            cwd: "/tmp/ohmypi-session-test",
            modelId: sharedModel.id,
            providerId: "bedrock",
        });

        expect(session.snapshot()).toMatchObject({
            modelId: sharedModel.id,
            models: [sharedModel, bedrockOnlyModel],
            providerId: "bedrock",
        });

        session.changeModel({ modelId: sharedModel.id, providerId: "codex" });

        expect(session.snapshot()).toMatchObject({
            modelId: sharedModel.id,
            models: [sharedModel],
            providerId: "codex",
        });
        const latestEvent = session.events.since(undefined)?.at(-1);
        expect(latestEvent).toBeDefined();
        if (latestEvent === undefined) {
            throw new Error("Expected a model change event.");
        }
        expect(latestEvent).toMatchObject({
            data: {
                modelId: sharedModel.id,
                snapshot: { providerId: "codex" },
            },
            type: "model_changed",
        });

        const inferredSession = store.create({
            cwd: "/tmp/ohmypi-session-test",
            modelId: bedrockOnlyModel.id,
        });
        expect(inferredSession.snapshot()).toMatchObject({
            modelId: bedrockOnlyModel.id,
            providerId: "bedrock",
        });
    });

    it("falls back when the configured model is no longer available", () => {
        const availableModel = defineModel({
            defaultThinkingLevel: "medium",
            id: "openai/available",
            name: "Available model",
            thinkingLevels: ["off", "medium"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: availableModel.id,
            defaultProviderId: "codex",
            models: [availableModel],
            providers: [{ providerId: "codex", models: [availableModel] }],
        };
        const store = new InMemorySessionStore({ modelCatalog: catalog });

        const session = store.create({
            cwd: "/tmp/ohmypi-session-test",
            effort: "max",
            modelId: "zai/glm-5",
            providerId: "bedrock",
        });

        expect(session.snapshot()).toMatchObject({
            effort: "medium",
            modelId: availableModel.id,
            models: [availableModel],
            providerId: "codex",
        });
    });

    it("keeps the requested model when another enabled provider serves it", () => {
        const sharedModel = defineModel({
            defaultThinkingLevel: "medium",
            id: "openai/shared",
            name: "Shared model",
            thinkingLevels: ["medium"],
        });
        const fallbackModel = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/fallback",
            name: "Fallback model",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: fallbackModel.id,
            defaultProviderId: "codex",
            models: [fallbackModel, sharedModel],
            providers: [
                { providerId: "codex", models: [fallbackModel] },
                { providerId: "openai", models: [sharedModel] },
            ],
        };
        const store = new InMemorySessionStore({ modelCatalog: catalog });

        const session = store.create({
            cwd: "/tmp/ohmypi-session-test",
            modelId: sharedModel.id,
            providerId: "bedrock",
        });

        expect(session.snapshot()).toMatchObject({
            modelId: sharedModel.id,
            models: [sharedModel],
            providerId: "openai",
        });
    });
});
