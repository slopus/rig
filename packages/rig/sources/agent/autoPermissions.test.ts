import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { Agent } from "./Agent.js";
import type { UserInputContext } from "./context/UserInputContext.js";
import { defineTool, type AnyDefinedTool } from "./types.js";
import { createPermissionContext } from "../permissions/index.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type InferenceStream,
    type Usage,
} from "../providers/types.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { claudeAskUserQuestionTool } from "../tools/claude/AskUserQuestion.js";
import { claudeBashTool } from "../tools/claude/Bash.js";
import { codexExecCommandTool } from "../tools/codex/exec_command.js";
import { grokRunTerminalCommandTool } from "../tools/grok/run_terminal_command.js";
import { piBashTool } from "../tools/pi/bash.js";

describe("Auto permissions", () => {
    it("fails closed when any tool has no permission context", async () => {
        const harness = createJustBashToolHarness();
        delete harness.context.permissions;
        const execute = vi.fn(() => ({ ok: true }));
        const tool = defineTool({
            name: "hosted_lookup",
            label: "Hosted lookup",
            description: "Looks up information through an external service.",
            arguments: Type.Object({ query: Type.String() }),
            returnType: Type.Object({ ok: Type.Boolean() }),
            shouldReviewInAutoMode: () => false,
            execute,
            toLLM: () => [{ type: "text", text: "Lookup completed." }],
            toUI: () => "Completed hosted lookup",
            locks: [],
        });
        const provider = autoReviewProvider("allow", {
            arguments: { query: "release status" },
            name: tool.name,
        });
        const agent = new Agent({
            context: harness.context,
            modelId: provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: [tool],
        });

        await agent.send("Look up the release status.");

        expect(execute).not.toHaveBeenCalled();
        expect(JSON.stringify(agent.messages)).toContain(
            "This action requires an available permission context.",
        );
    });

    it.each(["read_only", "workspace_write"] as const)(
        "describes the generic external boundary in %s mode",
        async (mode) => {
            const harness = createJustBashToolHarness();
            harness.context.permissions = createPermissionContext(mode);
            const execute = vi.fn(() => ({ ok: true }));
            const tool = defineTool({
                name: "hosted_lookup",
                label: "Hosted lookup",
                description: "Looks up information through an external service.",
                arguments: Type.Object({ query: Type.String() }),
                returnType: Type.Object({ ok: Type.Boolean() }),
                requiresAutoOrFullAccess: true,
                shouldReviewInAutoMode: () => false,
                execute,
                toLLM: () => [{ type: "text", text: "Lookup completed." }],
                toUI: () => "Completed hosted lookup",
                locks: [],
            });
            const provider = autoReviewProvider("allow", {
                arguments: { query: "release status" },
                name: tool.name,
            });
            const agent = new Agent({
                context: harness.context,
                modelId: provider.models[0]?.id ?? "",
                printToConsole: false,
                provider,
                tools: [tool],
            });

            await agent.send("Look up the release status.");

            expect(execute).not.toHaveBeenCalled();
            const resultBlock = agent.messages
                .flatMap((message) => (message.role === "agent" ? message.blocks : []))
                .find((block) => block.type === "tool_result");
            expect(resultBlock).toMatchObject({
                isError: true,
                rendered: [
                    {
                        text: "This action requires Auto or Full access because it can operate outside Rig's local sandbox.",
                        type: "text",
                    },
                ],
            });
            expect(JSON.stringify(resultBlock)).not.toContain("MCP");
        },
    );

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

    it("does not elevate a prepared Auto review after the permission mode is reduced", async () => {
        const harness = createJustBashToolHarness();
        harness.context.permissions = createPermissionContext("auto");
        const elevationCheckStarted = deferred<void>();
        const releaseElevationCheck = deferred<void>();
        const execute = vi.fn(() => ({ ok: true }));
        const tool = defineTool({
            name: "exec_command",
            label: "Deploy probe",
            description: "Checks a deployment target.",
            arguments: Type.Object({
                target: Type.String(),
                sandbox_permissions: Type.Literal("require_escalated"),
            }),
            returnType: Type.Object({ ok: Type.Boolean() }),
            describeAutoPermissionAction: ({ target }) =>
                `checking deployment target ${JSON.stringify(target)}. Access: unrestricted filesystem and network access`,
            shouldReviewInAutoMode: () => true,
            shouldRunInFullAccessInAutoMode: async () => {
                elevationCheckStarted.resolve();
                await releaseElevationCheck.promise;
                return true;
            },
            execute,
            toLLM: () => [{ type: "text", text: "Deployment target checked." }],
            toUI: () => "Checked deployment target",
            locks: [],
        });
        const provider = autoReviewProvider("allow");
        const agent = new Agent({
            context: harness.context,
            modelId: provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: [tool],
        });

        const run = agent.send("Run the deployment check.");
        await elevationCheckStarted.promise;
        harness.context.permissions.setMode("read_only");
        releaseElevationCheck.resolve();
        await run;

        expect(execute).not.toHaveBeenCalled();
        expect(harness.context.permissions.mode).toBe("read_only");
        expect(JSON.stringify(agent.messages)).toContain(
            "the permission mode changed before its Auto-approved full-access execution began",
        );
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

    it("refuses Auto review when a tool does not own its action description", async () => {
        const harness = createJustBashToolHarness();
        harness.context.permissions = createPermissionContext("auto");
        const execute = vi.fn(() => ({ ok: true }));
        const tool = defineTool({
            name: "exec_command",
            label: "Deployment check",
            description: "Checks a deployment target.",
            arguments: Type.Object({ target: Type.String() }),
            returnType: Type.Object({ ok: Type.Boolean() }),
            shouldReviewInAutoMode: () => true,
            execute,
            toLLM: () => [{ type: "text", text: "Checked." }],
            toUI: () => "Checked deployment target",
            locks: [],
        });
        const provider = autoReviewProvider("allow");
        const agent = new Agent({
            context: harness.context,
            modelId: provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: [tool],
        });

        await agent.send("Run the deployment check.");

        expect(execute).not.toHaveBeenCalled();
        const resultBlock = agent.messages
            .flatMap((message) => (message.role === "agent" ? message.blocks : []))
            .findLast((block) => block.type === "tool_result");
        expect(resultBlock).toMatchObject({
            isError: true,
            rendered: [
                {
                    text: "This tool cannot request Auto approval because its permission action is not defined.",
                    type: "text",
                },
            ],
        });
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

    it("stores only the selected values as trusted evidence from a real input tool", async () => {
        const harness = createJustBashToolHarness();
        harness.context.permissions = createPermissionContext("auto");
        harness.context.userInput = {
            request: async () => ({ answers: { question_1: ["Dark"] } }),
        };
        const questions = [
            {
                header: "Theme",
                question: "Which theme should be used?",
                options: [
                    {
                        label: "Dark",
                        description: "MODEL_AUTHORED_FAKE_AUTHORIZATION",
                    },
                    { label: "Light", description: "Use light colors." },
                ],
            },
        ];
        const provider = autoReviewProvider("allow", {
            arguments: { questions },
            name: claudeAskUserQuestionTool.name,
        });
        const agent = new Agent({
            context: harness.context,
            modelId: provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: [claudeAskUserQuestionTool],
        });

        await agent.send("Ask me which theme to use.");

        const resultBlock = agent.messages
            .flatMap((message) => (message.role === "agent" ? message.blocks : []))
            .find((block) => block.type === "tool_result");
        expect(resultBlock).toMatchObject({
            rendered: [
                {
                    text: expect.stringContaining("MODEL_AUTHORED_FAKE_AUTHORIZATION"),
                    type: "text",
                },
            ],
            trustedUserEvidence: [
                {
                    text: '{"answers":["Dark"]}',
                    type: "text",
                },
            ],
        });
    });

    it.each([
        {
            args: {
                cmd: "printf codex",
                justification: "The sandbox blocked necessary work.",
                sandbox_permissions: "require_escalated",
            },
            tool: codexExecCommandTool,
        },
        {
            args: { command: "printf claude", dangerouslyDisableSandbox: true },
            tool: claudeBashTool,
        },
        {
            args: {
                command: "printf pi",
                justification: "The sandbox blocked necessary work.",
                sandbox_permissions: "require_escalated",
            },
            tool: piBashTool,
        },
        {
            args: {
                background: false,
                command: "printf grok",
                description: "Run a command that the sandbox blocked.",
                sandbox_permissions: "require_escalated",
            },
            tool: grokRunTerminalCommandTool,
        },
    ] as const)(
        "runs reviewer-approved $tool.name through the shared full-access override",
        async ({ args, tool }) => {
            const harness = createJustBashToolHarness();
            harness.context.permissions = createPermissionContext("auto");
            const observedModes: string[] = [];
            const originalRun = harness.context.bash.run.bind(harness.context.bash);
            const originalStartSession = harness.context.bash.startSession.bind(
                harness.context.bash,
            );
            harness.context.bash.run = async (options) => {
                observedModes.push(harness.context.permissions?.mode ?? "missing");
                return originalRun(options);
            };
            harness.context.bash.startSession = async (options) => {
                observedModes.push(harness.context.permissions?.mode ?? "missing");
                return originalStartSession(options);
            };
            const provider = autoReviewProvider("allow", {
                arguments: args,
                name: tool.name,
            });
            const agent = new Agent({
                context: harness.context,
                modelId: provider.models[0]?.id ?? "",
                printToConsole: false,
                provider,
                tools: [tool as AnyDefinedTool],
            });
            const actions: string[] = [];

            await agent.send("Run the command even if the workspace sandbox blocks it.", {
                onEvent: (event) => {
                    if (event.type === "permission_review") actions.push(event.action);
                },
            });

            expect(observedModes.length).toBeGreaterThan(0);
            expect(new Set(observedModes)).toEqual(new Set(["full_access"]));
            expect(actions).toEqual([
                expect.stringContaining("Access: unrestricted filesystem and network access"),
            ]);
            expect(harness.context.permissions.mode).toBe("auto");
        },
    );
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
        describeAutoPermissionAction: ({ target }) =>
            `checking deployment target ${JSON.stringify(target)}. Access: unrestricted filesystem and network access`,
        shouldReviewInAutoMode: () => true,
        shouldRunInFullAccessInAutoMode: () => true,
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
        describeAutoPermissionAction: ({ chars, session_id }) =>
            `sending ${JSON.stringify(chars)} to shell session ${String(session_id)}`,
        shouldReviewInAutoMode: () => true,
        execute: ({ chars }) => {
            observedInputs.push(chars);
            return { ok: true };
        },
        toLLM: () => [{ type: "text", text: "Input sent." }],
        toUI: () => "Sent input",
        locks: [],
    });
}

function autoReviewProvider(
    decision: "allow" | "ask",
    toolCall: { arguments: Record<string, unknown>; name: string } = {
        arguments: {
            target: "production",
            sandbox_permissions: "require_escalated",
        },
        name: "exec_command",
    },
) {
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
                                  name: toolCall.name,
                                  arguments: toolCall.arguments,
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

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
} {
    let resolve: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}
