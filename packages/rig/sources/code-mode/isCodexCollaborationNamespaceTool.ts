import { getCodexCollaborationNamespaceDefinition } from "./getCodexCollaborationNamespaceDefinition.js";

export function isCodexCollaborationNamespaceTool(name: string): boolean {
    return getCodexCollaborationNamespaceDefinition(name) !== undefined;
}
