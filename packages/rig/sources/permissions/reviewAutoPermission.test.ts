import { describe, expect, it, vi } from "vitest";

import type { Message } from "../agent/types.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type InferenceStream,
} from "../providers/types.js";
import { reviewAutoPermission } from "./reviewAutoPermission.js";

describe("reviewAutoPermission", () => {
    it("still reviews low-risk actions when older user evidence exceeds the budget", async () => {
        const { model, provider, stream } = reviewer({
            decision: "allow",
            reason: "This is a routine local development action.",
            risk: "low",
            userAuthorization: "low",
        });

        await expect(
            reviewAutoPermission({
                args: { sandbox_permissions: "require_escalated" },
                messages: oversizedUserHistory(),
                model,
                now: () => 0,
                provider,
                toolName: "exec_command",
            }),
        ).resolves.toEqual({
            decision: "allow",
            reason: "This is a routine local development action.",
            risk: "low",
            userAuthorization: "low",
        });
        expect(stream).toHaveBeenCalledOnce();
    });

    it.each(["medium", "high"] as const)(
        "keeps %s-risk actions fail-closed when user evidence is incomplete",
        async (risk) => {
            const { model, provider, stream } = reviewer({
                decision: "allow",
                reason: "The retained messages authorize this action.",
                risk,
                userAuthorization: "high",
            });

            await expect(
                reviewAutoPermission({
                    args: { sandbox_permissions: "require_escalated" },
                    messages: oversizedUserHistory(),
                    model,
                    now: () => 0,
                    provider,
                    toolName: "exec_command",
                }),
            ).resolves.toEqual({
                decision: "ask",
                reason: "The full user authorization history did not fit in the automatic review.",
                risk,
                userAuthorization: "low",
            });
            expect(stream).toHaveBeenCalledOnce();
        },
    );
});

function oversizedUserHistory(): Message[] {
    return Array.from({ length: 7 }, (_, index) => ({
        role: "user",
        id: `user-${String(index)}`,
        blocks: [
            {
                type: "text",
                text: `USER_EVIDENCE_${String(index)} ${"e".repeat(10_000)}`,
            },
        ],
    }));
}

function reviewer(review: {
    decision: "allow" | "ask";
    reason: string;
    risk: "low" | "medium" | "high";
    userAuthorization: "low" | "medium" | "high";
}) {
    const model = defineModel({
        id: "openai/gpt-test",
        name: "GPT Test",
        thinkingLevels: ["off"],
        defaultThinkingLevel: "off",
    });
    const message: AssistantMessage = {
        api: "test",
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    decision: review.decision,
                    reason: review.reason,
                    risk: review.risk,
                    user_authorization: review.userAuthorization,
                }),
            },
        ],
        model: model.id,
        provider: "codex",
        role: "assistant",
        stopReason: "stop",
        timestamp: 1,
        usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 0,
            output: 0,
            totalTokens: 0,
        },
    };
    const stream = vi.fn(
        (): InferenceStream => ({
            async *[Symbol.asyncIterator]() {
                yield { message, reason: "stop" as const, type: "done" as const };
            },
            async result() {
                return message;
            },
        }),
    );
    return {
        model,
        provider: defineProvider({ id: "codex", models: [model], stream }),
        stream,
    };
}
