import { describe, expect, it } from "vitest";

import {
    modelAnthropicHaiku45,
    modelMoonshotKimiK25,
    modelMoonshotKimiK2Thinking,
    modelOpenaiGpt54,
    modelZaiGlm47Flash,
    modelZaiGlm5,
} from "./models.js";
import { createBedrockProvider } from "./bedrock.js";
import { getBedrockModelRoute } from "./getBedrockModelRoute.js";
import { isBedrockModelAvailableInRegion } from "./isBedrockModelAvailableInRegion.js";
import { readBedrockBearerToken } from "./readBedrockBearerToken.js";
import { resolveBedrockRegion } from "./resolveBedrockRegion.js";
import type { AssistantMessage, Model, TextContent } from "./types.js";

const LIVE = process.env.RIG_LIVE_TEST === "1";
const HAS_BEDROCK_TOKEN = readBedrockBearerToken(process.env) !== undefined;
const describeLive = LIVE && HAS_BEDROCK_TOKEN ? describe : describe.skip;
const LIVE_REGION = resolveBedrockRegion(process.env);
const GPT_54_REGIONS = ["us-east-1", "us-east-2", "us-west-2", "us-gov-west-1"];
const LIVE_OPENAI_MODEL = GPT_54_REGIONS.includes(LIVE_REGION) ? modelOpenaiGpt54 : undefined;
const LIVE_KIMI_MODEL = [modelMoonshotKimiK25, modelMoonshotKimiK2Thinking].find((model) => {
    const route = getBedrockModelRoute(model.id);
    return route !== undefined && isBedrockModelAvailableInRegion(route, LIVE_REGION);
});
const LIVE_GLM_MODEL = [modelZaiGlm5, modelZaiGlm47Flash].find((model) => {
    const route = getBedrockModelRoute(model.id);
    return route !== undefined && isBedrockModelAvailableInRegion(route, LIVE_REGION);
});

function textFromAssistantMessage(message: AssistantMessage): string {
    return message.content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("");
}

async function expectOkFromModel(model: Model, thinking = "off"): Promise<void> {
    const provider = createBedrockProvider({ env: process.env });
    const stream = provider.stream(
        model,
        {
            messages: [
                {
                    role: "user",
                    content: "Reply with exactly: ok",
                    timestamp: Date.now(),
                },
            ],
        },
        { thinking },
    );

    let sawStart = false;
    let sawText = false;
    for await (const event of stream) {
        if (event.type === "start") {
            sawStart = true;
        }
        if (event.type === "text_delta" && event.delta.length > 0) {
            sawText = true;
        }
        if (event.type === "error") {
            throw new Error(event.error.errorMessage ?? "Amazon Bedrock stream failed");
        }
    }

    const message = await stream.result();
    expect(sawStart).toBe(true);
    expect(sawText).toBe(true);
    expect(message.stopReason).not.toBe("error");
    expect(textFromAssistantMessage(message).trim().toLowerCase()).toBe("ok");
}

describeLive("Amazon Bedrock provider live", () => {
    it("streams an Anthropic model through Bedrock Runtime using the developer environment", async () => {
        await expectOkFromModel(modelAnthropicHaiku45);
    }, 120_000);

    it.skipIf(LIVE_OPENAI_MODEL === undefined)(
        "streams an OpenAI model through Bedrock Mantle using the developer environment",
        async () => {
            await expectOkFromModel(LIVE_OPENAI_MODEL!);
        },
        120_000,
    );

    it.skipIf(LIVE_KIMI_MODEL === undefined)(
        "streams a Kimi model through Bedrock Runtime using the developer environment",
        async () => {
            await expectOkFromModel(LIVE_KIMI_MODEL!, LIVE_KIMI_MODEL!.defaultThinkingLevel);
        },
        120_000,
    );

    it.skipIf(LIVE_GLM_MODEL === undefined)(
        "streams a GLM model through Bedrock Runtime using the developer environment",
        async () => {
            await expectOkFromModel(LIVE_GLM_MODEL!, LIVE_GLM_MODEL!.defaultThinkingLevel);
        },
        120_000,
    );
});

describe("Amazon Bedrock provider live prerequisites", () => {
    it("documents how to run the live test", () => {
        if (LIVE && !HAS_BEDROCK_TOKEN) {
            expect.fail("RIG_LIVE_TEST=1 is set but AWS_BEARER_TOKEN_BEDROCK is missing or blank");
        }

        expect(true).toBe(true);
    });
});
