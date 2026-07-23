import type { SessionTool } from "@/core/SessionTool.js";
import type { CodexToolDefinitionVendor } from "@/vendors/codex/CodexToolVendor.js";
import { toJsonSchema } from "@/vendors/codex/impl/toJsonSchema.js";

export function toCodexToolDefinitions(tools: readonly SessionTool[]): readonly unknown[] {
    const namespaceDescriptions = new Map([
        ["image_gen", "Tools in the image_gen namespace."],
        ["collaboration", "Tools for spawning and managing sub-agents."],
    ]);
    const output: unknown[] = [];
    const namespaces = new Map<
        string,
        { type: "namespace"; name: string; description: string; tools: unknown[] }
    >();

    for (const tool of tools) {
        const definition = toCodexTool(tool);
        if (tool.namespace === undefined) {
            output.push(definition);
            continue;
        }
        let namespace = namespaces.get(tool.namespace);
        if (namespace === undefined) {
            namespace = {
                type: "namespace",
                name: tool.namespace,
                description: namespaceDescriptions.get(tool.namespace) ?? "",
                tools: [],
            };
            namespaces.set(tool.namespace, namespace);
            output.push(namespace);
        }
        namespace.tools.push(definition);
    }
    return output;
}

function toCodexTool(tool: SessionTool): unknown {
    if (tool.name === "web_search" && tool.type === "cloud") {
        return {
            type: "web_search",
            external_web_access: false,
            search_content_types: ["text", "image"],
        };
    }
    const vendor = tool.vendor as Partial<CodexToolDefinitionVendor> | undefined;
    if (
        vendor?.provider === "codex" &&
        vendor.type === "tool_search" &&
        vendor.execution === "client"
    ) {
        return {
            type: "tool_search",
            execution: "client",
            description: tool.description,
            ...(tool.parameters === undefined ? {} : { parameters: toJsonSchema(tool.parameters) }),
        };
    }
    if (tool.grammar !== undefined) {
        return {
            type: "custom",
            name: tool.name,
            description: tool.description,
            format: { type: "grammar", syntax: "lark", definition: tool.grammar.grammar },
        };
    }
    return {
        type: "function",
        name: tool.name,
        description: tool.description,
        strict: false,
        ...(tool.parameters === undefined ? {} : { parameters: toJsonSchema(tool.parameters) }),
    };
}
