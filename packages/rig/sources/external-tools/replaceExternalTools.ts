import type { AnyDefinedTool } from "../agent/types.js";

export interface ExternalToolInstallation {
    installed: ReadonlySet<AnyDefinedTool>;
    shadowed: ReadonlyMap<string, AnyDefinedTool>;
}

export function replaceExternalTools(
    currentTools: readonly AnyDefinedTool[],
    externalTools: readonly AnyDefinedTool[],
    previous: ExternalToolInstallation,
): { installation: ExternalToolInstallation; tools: readonly AnyDefinedTool[] } {
    const restored = currentTools.filter((tool) => !previous.installed.has(tool));
    for (const tool of previous.shadowed.values()) {
        if (!restored.some((candidate) => candidate.name === tool.name)) restored.push(tool);
    }

    const externalNames = new Set(externalTools.map((tool) => tool.name));
    const shadowed = new Map<string, AnyDefinedTool>();
    const baseTools = restored.filter((tool) => {
        if (!externalNames.has(tool.name)) return true;
        shadowed.set(tool.name, tool);
        return false;
    });
    return {
        installation: { installed: new Set(externalTools), shadowed },
        tools: [...baseTools, ...externalTools],
    };
}
