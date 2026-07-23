import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const request_plugin_install = {
    name: "request_plugin_install",
    type: "local",
    description:
        "# Suggest a recommended plugin installation\n\nUse this tool only when all of the following are true:\n- The user explicitly asks to use a specific plugin that is not already available in the current context or active `tools` list.\n- Tool search has already been exhausted and did not find or make the requested tool callable.\n- The plugin is listed in `<recommended_plugins>`.\n\nDo not use it for adjacent capabilities, broad recommendations, or plugins that merely seem useful. Briefly explain why the plugin can help with the current request in `suggest_reason`.\n\nIMPORTANT: DO NOT call this tool in parallel with other tools.",
    parameters: Type.Object(
        {
            plugin_id: Type.String({
                description: "The parenthesized plugin ID from the `<recommended_plugins>` list.",
            }),
            suggest_reason: Type.String({
                description:
                    "Concise one-line user-facing reason why this plugin can help with the current request.",
            }),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
