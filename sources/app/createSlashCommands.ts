import type { AutocompleteItem } from "@earendil-works/pi-tui";

export interface SlashCommandItem extends AutocompleteItem {
    aliases: readonly string[];
}

export function createSlashCommands(): SlashCommandItem[] {
    return [
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
            value: "abort",
            label: "/abort",
            description: "Stop the current response.",
            aliases: [],
        },
    ];
}
