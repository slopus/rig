import { agentMessageToText } from "./agentMessageToText.js";
import { contentBlockToText } from "./contentBlockToText.js";
import type { Message } from "./types.js";

export interface AgentConsole {
    error?(...data: unknown[]): void;
    log(...data: unknown[]): void;
}

export function printAgentMessageToConsole(message: Message, output: AgentConsole = console): void {
    const text = (() => {
        if (message.role === "system" || message.role === "user") {
            return message.blocks.map(contentBlockToText).join("");
        }

        return agentMessageToText(message);
    })();

    output.log(`[${message.role}:${message.id}] ${text}`);
}
