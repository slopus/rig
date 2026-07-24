import { randomUUID } from "node:crypto";

import type {
    BaseProvider,
    ClaudeAuxiliaryQueryRequest,
    ClaudeAuxiliaryQueryResponse,
} from "@slopus/rig-providers";

export async function runProviderAuxiliaryText(options: {
    model: string;
    native: BaseProvider;
    request: ClaudeAuxiliaryQueryRequest;
}): Promise<ClaudeAuxiliaryQueryResponse> {
    const session = await options.native.session(`executor-auxiliary-${randomUUID()}`, {
        context: { instructions: options.request.systemPrompt, messages: [] },
        tools: [],
    });
    let text = "";
    try {
        for await (const event of session.run({
            ...(options.request.signal === undefined ? {} : { abort: options.request.signal }),
            context: {
                messages: [{ role: "user", content: options.request.prompt }],
            },
            model: options.model,
            effort: "off",
        })) {
            if (event.type === "text_delta") text += event.delta;
            if (event.type === "done" && event.state === "error") {
                throw new Error(event.message);
            }
        }
        return { content: [{ type: "text", text }] };
    } finally {
        await session.destroy();
    }
}
