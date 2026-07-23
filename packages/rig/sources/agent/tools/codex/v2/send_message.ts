import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { managedSubagentSchema } from "../impl/subagentSchemas.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";

export const codexSendMessageTool = defineTool({
    name: "send_message",
    label: "send_message",
    namespace: {
        name: "collaboration",
        description: "Tools for spawning and managing sub-agents.",
    },
    description: "Send a message to an existing subagent without starting another turn.",
    arguments: Type.Object(
        {
            target: Type.String(),
            message: Type.String({
                description: "Message text to queue on the target agent.",
                encrypted: true,
            }),
        },
        { additionalProperties: false },
    ),
    returnType: managedSubagentSchema,
    shouldReviewInAutoMode: () => false,
    execute: (args, context) => {
        const { message, target } = args;
        const subagents = requireSubagentContext(context);
        const sendMessage = subagents.sendMessage;
        if (sendMessage === undefined) throw new Error("Subagent messaging is unavailable.");
        return subagents.encryptedMessages === true
            ? sendMessage(target, "", message)
            : sendMessage(target, message);
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Sent a message to ${result.description}.`,
    locks: [],
});
