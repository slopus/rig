import type { SessionSystemMessage } from "@/core/SessionContext.js";

export function createCodexModelSwitchMessage(instructions: string): SessionSystemMessage {
    return {
        role: "system",
        content: [
            [
                "<model_switch>",
                "The user was previously using a different model. Please continue the conversation according to the following instructions:",
                "",
                instructions,
                "",
                "</model_switch>",
            ].join("\n"),
        ],
    };
}
