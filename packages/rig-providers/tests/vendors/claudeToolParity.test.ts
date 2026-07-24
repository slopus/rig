import { describe, expect, it } from "vitest";

import { resolveClaudeTools } from "@/vendors/claude/impl/resolveClaudeTools.js";
import { assembleClaudeTools } from "../../../rig/sources/agent/tools/claude/assembleClaudeTools.js";

describe("Claude provider tool goldens", () => {
    it.each(["opus[1m]", "sonnet[1m]"])(
        "matches the production Claude tool contract for %s",
        (model) => {
            const productionTools = assembleClaudeTools().map((tool) => ({
                description: tool.description,
                name: tool.name,
                parameters: tool.arguments,
                type: "local",
            }));
            const goldenTools = resolveClaudeTools(model);
            const productionNames = productionTools.map((tool) => tool.name).sort();
            const goldenNames = goldenTools.map((tool) => tool.name).sort();

            expect(productionNames).toEqual(goldenNames);
            expect(productionTools.map(modelFacingShape).sort(byToolName)).toEqual(
                goldenTools
                    .map((tool) => ({
                        name: tool.name,
                        parameters: tool.parameters,
                    }))
                    .map(modelFacingShape)
                    .sort(byToolName),
            );
            for (const name of ["Agent", "TaskOutput", "TaskStop"]) {
                expect(productionTools.find((tool) => tool.name === name)).toEqual(
                    goldenTools.find((tool) => tool.name === name),
                );
            }
        },
    );
});

function modelFacingShape(tool: { name: string; parameters: unknown }): unknown {
    return {
        name: tool.name,
        parameters: schemaShape(tool.parameters),
    };
}

function schemaShape(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(schemaShape);
    if (typeof value !== "object" || value === null) return value;
    const schema = value as Record<string, unknown>;
    // Native fixtures retain Claude's prompt metadata while production tools adapt descriptions
    // and validation to Rig's shared permission and subagent contracts. Compare the complete
    // callable structure here; tools whose full native contract must match are asserted above.
    return {
        ...("anyOf" in schema ? { anyOf: schemaShape(schema.anyOf) } : {}),
        ...("const" in schema ? { const: schema.const } : {}),
        ...("items" in schema ? { items: schemaShape(schema.items) } : {}),
        ...("properties" in schema &&
        Object.keys(schema.properties as Record<string, unknown>).length > 0
            ? {
                  properties: Object.fromEntries(
                      Object.entries(schema.properties as Record<string, unknown>).map(
                          ([name, property]) => [name, schemaShape(property)],
                      ),
                  ),
              }
            : {}),
        ...("required" in schema ? { required: [...(schema.required as string[])].sort() } : {}),
        ...("type" in schema ? { type: schema.type } : {}),
    };
}

function byToolName(left: unknown, right: unknown): number {
    const leftName = (left as { name: string }).name;
    const rightName = (right as { name: string }).name;
    return leftName.localeCompare(rightName);
}
