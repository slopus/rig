import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { Agent } from "./Agent.js";
import type { UserInputContext } from "./context/UserInputContext.js";
import { defineTool } from "./types.js";
import { createPermissionContext } from "../permissions/index.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type InferenceStream,
    type Usage,
} from "../providers/types.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";

describe("Auto permissions", () => {
    it("runs a reviewer-approved action with host access and no extra prompt", async () => {
        const harness = createJustBashToolHarness();
        harness.context.permissions = createPermissionContext("auto");
        const observedModes: string[] = [];
        const tool = permissionProbeTool(observedModes);
        const provider = autoReviewProvider("allow");
        const request = vi.fn<UserInputContext["request"]>(async () => ({
            answers: { permission: ["Deny"] },
        }));
        harness.context.userInput = { request };
        const agent = new Agent({
            context: harness.context,
            modelId: provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: [tool],
        });
        const events: string[] = [];

        const result = await agent.send("Run the deployment check.", {
            onEvent: (event) => {
                if (event.type === "permission_review") {
                    events.push(
                        `${event.decision}:${event.risk}:${event.userAuthorization}:${event.reason}`,
                    );
                }
            },
        });

        expect(result.stopReason).toBe("stop");
        expect(observedModes).toEqual(["full_access"]);
        expect(request).not.toHaveBeenCalled();
        expect(events).toEqual(["allow:low:high:This is a low-risk development check."]);
        expect(harness.context.permissions.mode).toBe("auto");
    });

    it("sends reviewer-approved shell input without a second prompt", async () => {
        const harness = createJustBashToolHarness();
        harness.context.permissions = createPermissionContext("auto");
        const observedInputs: string[] = [];
        const tool = sessionInputProbeTool(observedInputs);
        const provider = compromisedSessionInputReviewProvider();
        const request = vi.fn<UserInputContext["request"]>(async () => ({
            answers: { permission: ["Deny"] },
        }));
        harness.context.userInput = { request };
        const agent = new Agent({
            context: harness.context,
            modelId: provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: [tool],
        });
        const reviews: string[] = [];

        const result = await agent.send("Do not send anything to the running shell.", {
            onEvent: (event) => {
                if (event.type === "permission_review") {
                    reviews.push(`${event.decision}:${event.action}:${event.reason}`);
                }
            },
        });

        expect(result.stopReason).toBe("stop");
        expect(observedInputs).toEqual(["printf 'owned' > /workspace/compromised-input.txt\n"]);
        expect(request).not.toHaveBeenCalled();
        expect(reviews).toEqual([
            `allow:sending "printf 'owned' > /workspace/compromised-input.txt\\n" to shell session 73:The user already authorized sending this input.`,
        ]);
    });

    it("asks the user for uncertain actions and honors a denial", async () => {
        const harness = createJustBashToolHarness();
        harness.context.permissions = createPermissionContext("auto");
        const observedModes: string[] = [];
        const tool = permissionProbeTool(observedModes);
        const provider = autoReviewProvider("ask");
        const request = vi.fn<UserInputContext["request"]>(async () => ({
            answers: { permission: ["Deny"] },
        }));
        harness.context.userInput = { request };
        const agent = new Agent({
            context: harness.context,
            modelId: provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: [tool],
        });

        await agent.send("Check whether deployment is possible.");

        expect(observedModes).toEqual([]);
        expect(request).toHaveBeenCalledOnce();
        const permissionRequest = request.mock.calls[0]?.[0];
        expect(permissionRequest).toMatchObject({
            requestId: "tool-call-1:permission",
            questions: [{ header: "Permission", id: "permission" }],
        });
        const resultMessage = agent.messages.findLast(
            (message) =>
                message.role === "agent" &&
                message.blocks.some((block) => block.type === "tool_result"),
        );
        expect(resultMessage?.blocks).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    isError: true,
                    rendered: [
                        expect.objectContaining({
                            text: expect.stringContaining("Auto mode did not approve"),
                        }),
                    ],
                }),
            ]),
        );
    });
});

function permissionProbeTool(observedModes: string[]) {
    return defineTool({
        name: "exec_command",
        label: "Deploy probe",
        description: "Checks a deployment target.",
        arguments: Type.Object({
            target: Type.String(),
            sandbox_permissions: Type.Literal("require_escalated"),
        }),
        returnType: Type.Object({ ok: Type.Boolean() }),
        execute: (_args, context) => {
            observedModes.push(context.permissions?.mode ?? "missing");
            return { ok: true };
        },
        toLLM: () => [{ type: "text", text: "Deployment target checked." }],
        toUI: () => "Checked deployment target",
        locks: [],
    });
}

function sessionInputProbeTool(observedInputs: string[]) {
    return defineTool({
        name: "write_stdin",
        label: "Shell input probe",
        description: "Sends input to a running shell session.",
        arguments: Type.Object({
            chars: Type.String(),
            session_id: Type.Number(),
        }),
        returnType: Type.Object({ ok: Type.Boolean() }),
        execute: ({ chars }) => {
            observedInputs.push(chars);
            return { ok: true };
        },
        toLLM: () => [{ type: "text", text: "Input sent." }],
        toUI: () => "Sent input",
        locks: [],
    });
}

function autoReviewProvider(decision: "allow" | "ask") {
    const model = defineModel({
        id: "openai/gpt-test",
        name: "GPT Test",
        thinkingLevels: ["off"],
        defaultThinkingLevel: "off",
    });
    let mainCalls = 0;
    return defineProvider({
        id: "codex",
        models: [model],
        stream(_model, context) {
            if (context.systemPrompt?.includes("independent permission reviewer")) {
                return streamFor(
                    assistantMessage({
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    decision,
                                    risk: decision === "allow" ? "low" : "high",
                                    user_authorization: decision === "allow" ? "high" : "medium",
                                    reason:
                                        decision === "allow"
                                            ? "This is a low-risk development check."
                                            : "This could change an external deployment.",
                                }),
                            },
                        ],
                        stopReason: "stop",
                    }),
                );
            }
            mainCalls += 1;
            return mainCalls === 1
                ? streamFor(
                      assistantMessage({
                          content: [
                              {
                                  type: "toolCall",
                                  id: "tool-call-1",
                                  name: "exec_command",
                                  arguments: {
                                      target: "production",
                                      sandbox_permissions: "require_escalated",
                                  },
                              },
                          ],
                          stopReason: "toolUse",
                      }),
                  )
                : streamFor(
                      assistantMessage({
                          content: [{ type: "text", text: "Done." }],
                          stopReason: "stop",
                      }),
                  );
        },
    });
}

function compromisedSessionInputReviewProvider() {
    const model = defineModel({
        id: "openai/gpt-test",
        name: "GPT Test",
        thinkingLevels: ["off"],
        defaultThinkingLevel: "off",
    });
    let mainCalls = 0;
    return defineProvider({
        id: "codex",
        models: [model],
        stream(_model, context) {
            if (context.systemPrompt?.includes("independent permission reviewer")) {
                return streamFor(
                    assistantMessage({
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    decision: "allow",
                                    risk: "low",
                                    user_authorization: "high",
                                    reason: "The user already authorized sending this input.",
                                }),
                            },
                        ],
                        stopReason: "stop",
                    }),
                );
            }
            mainCalls += 1;
            return mainCalls === 1
                ? streamFor(
                      assistantMessage({
                          content: [
                              {
                                  type: "toolCall",
                                  id: "write-stdin-call-1",
                                  name: "write_stdin",
                                  arguments: {
                                      chars: "printf 'owned' > /workspace/compromised-input.txt\n",
                                      session_id: 73,
                                  },
                              },
                          ],
                          stopReason: "toolUse",
                      }),
                  )
                : streamFor(
                      assistantMessage({
                          content: [{ type: "text", text: "Done." }],
                          stopReason: "stop",
                      }),
                  );
        },
    });
}

function assistantMessage(
    input: Pick<AssistantMessage, "content" | "stopReason">,
): AssistantMessage {
    return {
        role: "assistant",
        content: input.content,
        api: "test",
        provider: "codex",
        model: "openai/gpt-test",
        usage: zeroUsage(),
        stopReason: input.stopReason,
        timestamp: 1,
    };
}

function streamFor(message: AssistantMessage): InferenceStream {
    return {
        async *[Symbol.asyncIterator]() {
            yield { type: "start" as const, partial: message };
            yield {
                type: "done" as const,
                reason: message.stopReason as "stop" | "toolUse",
                message,
            };
        },
        async result() {
            return message;
        },
    };
}

function zeroUsage(): Usage {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}
