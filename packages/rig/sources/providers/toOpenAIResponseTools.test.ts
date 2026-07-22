import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { toOpenAIResponseTools } from "./toOpenAIResponseTools.js";

describe("toOpenAIResponseTools", () => {
    it("preserves the Codex custom exec grammar instead of converting it to a function", () => {
        expect(
            toOpenAIResponseTools([
                {
                    kind: "custom",
                    name: "exec",
                    description: "Run JavaScript code.",
                    format: {
                        type: "grammar",
                        syntax: "lark",
                        definition: 'start: "run"',
                    },
                },
                {
                    kind: "function",
                    name: "wait",
                    description: "Wait for a running cell.",
                    parameters: Type.Object({ cell_id: Type.String() }),
                },
                {
                    kind: "namespace",
                    name: "collaboration",
                    description: "Manage agents.",
                    tools: [
                        {
                            name: "spawn_agent",
                            description: "Spawn an agent.",
                            parameters: Type.Object({
                                message: Type.String({ encrypted: true }),
                            }),
                        },
                    ],
                },
                {
                    kind: "namespace",
                    name: "rig",
                    description: "Provider-neutral agent tools.",
                    tools: [
                        {
                            name: "spawn_agent",
                            description: "Spawn any Rig agent.",
                            parameters: Type.Object({ provider: Type.Optional(Type.String()) }),
                        },
                    ],
                },
            ]),
        ).toEqual([
            {
                type: "custom",
                name: "exec",
                description: "Run JavaScript code.",
                format: {
                    type: "grammar",
                    syntax: "lark",
                    definition: 'start: "run"',
                },
            },
            {
                type: "function",
                name: "wait",
                description: "Wait for a running cell.",
                parameters: Type.Object({ cell_id: Type.String() }),
                strict: false,
            },
            {
                type: "namespace",
                name: "collaboration",
                description: "Manage agents.",
                tools: [
                    {
                        type: "function",
                        name: "spawn_agent",
                        description: "Spawn an agent.",
                        parameters: Type.Object({
                            message: Type.String({ encrypted: true }),
                        }),
                        strict: false,
                    },
                ],
            },
            {
                type: "namespace",
                name: "rig",
                description: "Provider-neutral agent tools.",
                tools: [
                    {
                        type: "function",
                        name: "spawn_agent",
                        description: "Spawn any Rig agent.",
                        parameters: Type.Object({ provider: Type.Optional(Type.String()) }),
                        strict: false,
                    },
                ],
            },
        ]);
    });
});
