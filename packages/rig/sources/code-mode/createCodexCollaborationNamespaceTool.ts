import type { AnyDefinedTool } from "../agent/types.js";
import { getCodexCollaborationNamespaceDefinition } from "./getCodexCollaborationNamespaceDefinition.js";
import { resolveCodexForkTurns } from "./resolveCodexForkTurns.js";

export function createCodexCollaborationNamespaceTool(tool: AnyDefinedTool): AnyDefinedTool {
    const definition = getCodexCollaborationNamespaceDefinition(tool.name);
    if (definition === undefined) {
        throw new Error(
            `'collaboration.${tool.name}' is not an official Codex collaboration tool.`,
        );
    }
    return {
        ...tool,
        description: definition.description,
        arguments: definition.parameters,
        codeMode: { ...tool.codeMode, namespace: "collaboration" },
        execute: (args, context, execution) =>
            tool.execute(toRigArguments(tool.name, args) as never, context, execution),
    };
}

function toRigArguments(name: string, args: never): unknown {
    if (name === "followup_task") {
        const official = args as { message: string; target: string };
        return {
            encrypted_message: official.message,
            message: "",
            target: official.target,
        };
    }
    if (name !== "spawn_agent") return args;
    const official = args as { fork_turns?: string; message: string; task_name: string };
    const fork = resolveCodexForkTurns(official.fork_turns);
    return {
        context: fork.contextMode,
        encrypted_message: official.message,
        ...(fork.lastNTurns === undefined ? {} : { last_n_turns: fork.lastNTurns }),
        message: "",
        task_name: official.task_name,
    };
}
