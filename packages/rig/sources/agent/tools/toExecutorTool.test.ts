import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { defineTool } from "../types.js";
import { toExecutorTool } from "./toExecutorTool.js";

describe("toExecutorTool", () => {
    it("converts the Rig schema without dropping execution metadata from the Rig definition", () => {
        const tool = defineTool({
            name: "read_file",
            label: "Read file",
            description: "Read one file.",
            arguments: Type.Object(
                { path: Type.String({ description: "Path to read." }) },
                { additionalProperties: false },
            ),
            returnType: Type.Object({ text: Type.String() }),
            shouldReviewInAutoMode: () => false,
            execute: async ({ path }) => ({ text: path }),
            toLLM: ({ text }) => [{ type: "text", text }],
            toUI: ({ text }) => text,
            locks: [],
        });

        expect(toExecutorTool(tool)).toEqual({
            name: "read_file",
            description: "Read one file.",
            parameters: tool.arguments,
        });
        expect(tool.execute).toBeTypeOf("function");
        expect(tool.shouldReviewInAutoMode).toBeTypeOf("function");
    });

    it("passes an exact provider-facing definition through unchanged", () => {
        const executorTool = {
            kind: "custom" as const,
            name: "apply_patch",
            description: "Apply a patch.",
            format: {
                type: "grammar" as const,
                syntax: "lark" as const,
                definition: "start: PATCH",
            },
        };
        const tool = defineTool({
            name: "apply_patch",
            label: "Apply patch",
            description: "Apply a patch.",
            executorTool,
            arguments: Type.Object({ patch: Type.String() }),
            returnType: Type.Object({ text: Type.String() }),
            shouldReviewInAutoMode: () => false,
            execute: async () => ({ text: "done" }),
            toLLM: ({ text }) => [{ type: "text", text }],
            toUI: ({ text }) => text,
            locks: [],
        });

        expect(toExecutorTool(tool)).toBe(executorTool);
    });
});
