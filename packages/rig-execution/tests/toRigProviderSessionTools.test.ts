import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { toRigProviderSessionTools } from "../sources/createExecutorInferenceStream.js";

describe("toRigProviderSessionTools", () => {
    it("preserves caller-owned namespaced tool definitions", () => {
        const parameters = Type.Object({
            timeout_ms: Type.Optional(Type.Number()),
        });

        const tools = toRigProviderSessionTools([
            {
                name: "wait_agent",
                description: "Wait for an agent update.",
                parameters,
                namespace: "collaboration",
                namespaceDescription: "Caller-owned collaboration tools.",
            },
        ]);

        expect(tools).toEqual([
            {
                name: "wait_agent",
                namespace: "collaboration",
                namespaceDescription: "Caller-owned collaboration tools.",
                type: "local",
                description: "Wait for an agent update.",
                parameters,
            },
        ]);
        expect(tools[0]?.parameters).toBe(parameters);
    });

    it("replaces native Codex collaboration schemas with locked definitions", () => {
        const tools = toRigProviderSessionTools(
            [
                {
                    name: "wait_agent",
                    description: "Modified definition.",
                    parameters: Type.Object({ incompatible: Type.String() }),
                    namespace: "collaboration",
                    namespaceDescription: "Caller replacement.",
                },
            ],
            { lockCodexCollaboration: true },
        );

        expect(tools).toMatchObject([
            {
                name: "wait_agent",
                namespace: "collaboration",
                namespaceDescription: "Tools for spawning and managing sub-agents.",
                description: expect.stringContaining("Wait for a mailbox update"),
                parameters: {
                    additionalProperties: false,
                    properties: { timeout_ms: { type: "number" } },
                    type: "object",
                },
            },
        ]);
        expect(JSON.stringify(tools)).not.toContain("incompatible");
        expect(JSON.stringify(tools)).not.toContain("Caller replacement");
    });

    it("locks native collaboration while preserving cross-provider spawn separately", () => {
        const extParameters = Type.Object({
            message: Type.String(),
            model: Type.String(),
            provider: Type.String(),
        });
        const tools = toRigProviderSessionTools(
            [
                {
                    name: "spawn_agent",
                    description: "Modified native spawn.",
                    parameters: Type.Object({}),
                    namespace: "collaboration",
                },
                {
                    name: "spawn_agent",
                    description: "Cross-provider spawn.",
                    parameters: extParameters,
                    namespace: "collaboration_ext",
                },
            ],
            { lockCodexCollaboration: true },
        );

        expect(tools.map((tool) => `${tool.namespace}.${tool.name}`)).toEqual([
            "collaboration.spawn_agent",
            "collaboration_ext.spawn_agent",
        ]);
        expect(tools[0]?.parameters?.properties?.message).toHaveProperty("encrypted", true);
        expect(tools[1]?.parameters).toBe(extParameters);
        expect(tools[1]?.parameters?.properties).toMatchObject({
            model: { type: "string" },
            provider: { type: "string" },
        });
    });

    it("keeps plaintext fallback fields for non-Codex namespaces", () => {
        const parameters = Type.Object({
            message: Type.String({ description: "Plain-text task." }),
        });

        const [tool] = toRigProviderSessionTools([
            {
                name: "spawn_agent",
                description: "Spawn with a plaintext task.",
                parameters,
                namespace: "rig",
                namespaceDescription: "Provider-neutral collaboration tools.",
            },
        ]);

        expect(tool?.namespaceDescription).toBe("Provider-neutral collaboration tools.");
        expect(tool?.parameters).toBe(parameters);
        expect(tool?.parameters?.properties?.message).not.toHaveProperty("encrypted");
    });

    it("rejects extensions to native Codex collaboration", () => {
        expect(() =>
            toRigProviderSessionTools(
                [
                    {
                        name: "custom_agent_action",
                        description: "Not native.",
                        parameters: Type.Object({}),
                        namespace: "collaboration",
                        namespaceDescription: "Native collaboration.",
                    },
                ],
                { lockCodexCollaboration: true },
            ),
        ).toThrow(
            "'collaboration.custom_agent_action' is not a locked Codex collaboration function.",
        );
    });
});
