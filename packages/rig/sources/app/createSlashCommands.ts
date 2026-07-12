import type { AutocompleteItem } from "@earendil-works/pi-tui";

export interface SlashCommandItem extends AutocompleteItem {
    aliases: readonly string[];
}

export function createSlashCommands(
    options: { workflowsEnabled?: boolean } = {},
): SlashCommandItem[] {
    const commands: SlashCommandItem[] = [
        {
            value: "model",
            label: "/model",
            description: "Choose the model and reasoning level.",
            aliases: [],
        },
        {
            value: "effort",
            label: "/effort",
            description: "Change reasoning for this session.",
            aliases: ["ford", "reasoning"],
        },
        {
            value: "configure",
            label: "/configure",
            description: "Configure app settings.",
            aliases: ["config", "settings"],
        },
        {
            value: "permissions",
            label: "/permissions",
            description: "Choose filesystem, shell, and network access.",
            aliases: ["permission"],
        },
        {
            value: "mcp",
            label: "/mcp",
            description: "Show configured MCP server connections.",
            aliases: [],
        },
        {
            value: "tasks",
            label: "/tasks",
            description: "Show the current session task list.",
            aliases: ["todos"],
        },
        {
            value: "usage",
            label: "/usage",
            description: "Show token usage for this session.",
            aliases: ["tokens"],
        },
        {
            value: "agents",
            label: "/agents",
            description: "Show delegated work and its current status.",
            aliases: [],
        },
        {
            value: "goal",
            label: "/goal",
            description: "Set or manage a persistent long-running goal.",
            aliases: [],
        },
        {
            value: "review",
            label: "/review",
            description: "Review current changes and find actionable issues.",
            aliases: [],
        },
        {
            value: "new",
            label: "/new",
            description: "Reset this session and start fresh.",
            aliases: ["reset"],
        },
        {
            value: "exit",
            label: "/exit",
            description: "Close Rig.",
            aliases: [],
        },
        {
            value: "clear",
            label: "/clear",
            description: "Clear the visible conversation.",
            aliases: [],
        },
        {
            value: "compact",
            label: "/compact",
            description: "Summarize older messages to free context space.",
            aliases: [],
        },
        {
            value: "abort",
            label: "/abort",
            description: "Stop the current response and background commands.",
            aliases: [],
        },
    ];
    if (options.workflowsEnabled !== false) {
        commands.splice(8, 0, {
            value: "workflows",
            label: "/workflows",
            description: "Open the live workflow monitor.",
            aliases: ["workflow"],
        });
    }
    return commands;
}
