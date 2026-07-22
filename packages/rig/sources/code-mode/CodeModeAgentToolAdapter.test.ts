import type {
    CodeModeRunOptions,
    CodeModeSessionOptions,
    CodeModeTool,
} from "@slopus/rig-codemode-codex";
import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { defineTool, type NestedToolInvocation } from "../agent/types.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { CodeModeAgentToolAdapter } from "./CodeModeAgentToolAdapter.js";
import { createCodexCollaborationNamespaceTool } from "./createCodexCollaborationNamespaceTool.js";
import { createRigNamespaceTool } from "./createRigNamespaceTool.js";

describe("CodeModeAgentToolAdapter", () => {
    it("matches Codex's exec, wait, direct input, and collaboration namespace split", () => {
        const adapter = new CodeModeAgentToolAdapter({ sessionId: "test" });
        const nested = tool("exec_command");
        const direct = { ...tool("request_user_input"), codeMode: { exposure: "direct" as const } };
        const collaboration = createCodexCollaborationNamespaceTool(tool("spawn_agent"));

        const rig = createRigNamespaceTool(tool("spawn_agent"));
        const adaptation = adapter.adapt([nested, direct, collaboration, rig]);

        expect(adaptation.exposedTools.map((tool) => tool.name)).toEqual([
            "exec",
            "wait",
            "request_user_input",
            "collaboration",
            "rig",
        ]);
        expect(
            adaptation.exposedTools.map((tool) => tool.providerTool?.kind ?? "function"),
        ).toEqual(["custom", "function", "function", "namespace", "namespace"]);
        expect(adaptation.exposedTools[0]?.description).toContain("exec_command(args:");
        expect(adaptation.exposedTools[0]?.description).not.toContain("tools.spawn_agent");
        expect(adaptation.exposedTools[0]?.description).not.toContain("`audio(");
        expect(adaptation.exposedTools[0]?.description).not.toContain("`notify(");
        expect(adaptation.exposedTools[3]?.providerTool).toMatchObject({
            kind: "namespace",
            name: "collaboration",
            tools: [{ name: "spawn_agent" }],
        });
        expect(adaptation.exposedTools[4]?.providerTool).toMatchObject({
            description: "Rig's provider-neutral tools for managing agents and workflows.",
            kind: "namespace",
            name: "rig",
            tools: [{ name: "spawn_agent" }],
        });
        expect(adaptation.nestedTools.map((tool) => tool.name)).toEqual([
            "exec_command",
            "spawn_agent",
            "spawn_agent",
        ]);
    });

    it("rejects extensions and modified schemas in Codex's reserved namespace", () => {
        const adapter = new CodeModeAgentToolAdapter({ sessionId: "test" });
        const extension = {
            ...tool("workflow"),
            codeMode: { namespace: "collaboration" },
        };
        const modifiedOfficialTool = {
            ...tool("spawn_agent"),
            codeMode: { namespace: "collaboration" },
        };

        expect(() => adapter.adapt([extension])).toThrow(
            "'collaboration.workflow' must exactly match the official Codex definition.",
        );
        expect(() => adapter.adapt([modifiedOfficialTool])).toThrow(
            "'collaboration.spawn_agent' must exactly match the official Codex definition.",
        );
        expect(() =>
            adapter.adapt([createCodexCollaborationNamespaceTool(tool("spawn_agent", "durable"))]),
        ).toThrow("'collaboration.spawn_agent' cannot be exposed as a durable direct tool.");
    });

    it("exposes durable tools directly instead of creating unrecoverable nested calls", () => {
        const adapter = new CodeModeAgentToolAdapter({ sessionId: "test" });
        const durable = tool("external", "durable");

        const adaptation = adapter.adapt([tool("exec_command"), durable]);

        expect(adaptation.exposedTools.map((candidate) => candidate.name)).toEqual([
            "exec",
            "wait",
            "external",
        ]);
        expect(adaptation.exposedTools[0]?.description).not.toContain("external(args:");
        expect(adaptation.nestedTools.map((candidate) => candidate.name)).toEqual(["exec_command"]);
    });

    it("retries host and session creation after rejected cached promises", async () => {
        let hostAttempt = 0;
        let sessionAttempt = 0;
        const session = {
            close: async () => undefined,
            execute: async () => ({ state: "result" as const, cellId: "cell", contentItems: [] }),
            terminate: async (cellId: string) => ({
                state: "terminated" as const,
                cellId,
                contentItems: [],
            }),
            wait: async (cellId: string) => ({
                state: "result" as const,
                cellId,
                contentItems: [],
            }),
        };
        const create = vi.fn(async () => {
            hostAttempt += 1;
            if (hostAttempt === 1) throw new Error("host unavailable");
            return {
                close: async () => undefined,
                createSession: async () => {
                    sessionAttempt += 1;
                    if (sessionAttempt === 1) throw new Error("session unavailable");
                    return session;
                },
            };
        }) as never;
        const adapter = new CodeModeAgentToolAdapter({ create, sessionId: "test" });
        const exec = adapter.adapt([tool("inspect")]).exposedTools[0]!;
        const context = createJustBashToolHarness().context;
        const execution = { invokeTool: vi.fn(), toolCallId: "exec" };

        await expect(exec.execute({ input: "1" } as never, context, execution)).rejects.toThrow(
            "host unavailable",
        );
        await expect(exec.execute({ input: "1" } as never, context, execution)).rejects.toThrow(
            "session unavailable",
        );
        await expect(
            exec.execute({ input: "1" } as never, context, execution),
        ).resolves.toMatchObject({ state: "result" });

        expect(create).toHaveBeenCalledTimes(2);
        expect(sessionAttempt).toBe(2);
    });

    it("cleans up reset without replaying a concurrent host creation failure", async () => {
        let rejectHost!: (error: Error) => void;
        const host = new Promise<never>((_resolve, reject) => {
            rejectHost = reject;
        });
        const adapter = new CodeModeAgentToolAdapter({
            create: vi.fn(() => host) as never,
            sessionId: "test",
        });
        const exec = adapter.adapt([tool("inspect")]).exposedTools[0]!;
        const context = createJustBashToolHarness().context;
        const executing = exec.execute({ input: "1" } as never, context, {
            invokeTool: vi.fn(),
            toolCallId: "exec",
        });
        const resetting = adapter.reset();

        rejectHost(new Error("host creation failed"));

        await expect(executing).rejects.toThrow("host creation failed");
        await expect(resetting).resolves.toBeUndefined();
    });

    it("binds yielded cells to the current wait dispatch and globally unique nested ids", async () => {
        const cells = new Map<string, readonly CodeModeTool[]>();
        let nextCell = 0;
        const create = async () =>
            ({
                close: async () => undefined,
                createSession: async (_options: CodeModeSessionOptions) => ({
                    close: async () => undefined,
                    execute: async (_code: string, options: CodeModeRunOptions) => {
                        const cellId = `cell-${++nextCell}`;
                        cells.set(cellId, options.tools ?? []);
                        return { state: "yielded" as const, cellId, contentItems: [] };
                    },
                    terminate: async (cellId: string) => ({
                        state: "terminated" as const,
                        cellId,
                        contentItems: [],
                    }),
                    wait: async (cellId: string) => {
                        const nested = cells.get(cellId)?.[0];
                        if (nested === undefined) throw new Error(`Missing tools for ${cellId}`);
                        await nested.execute(
                            { value: cellId },
                            {
                                cellId,
                                runtimeToolCallId: "tool-1",
                                signal: new AbortController().signal,
                                toolKind: "function",
                                toolName: { name: "inspect" },
                            },
                        );
                        return { state: "result" as const, cellId, contentItems: [] };
                    },
                }),
            }) as never;
        const adapter = new CodeModeAgentToolAdapter({ create, sessionId: "test" });
        const [exec, wait] = adapter.adapt([tool("inspect")]).exposedTools;
        const context = createJustBashToolHarness().context;
        const firstInvoker = vi.fn(async (_invocation: NestedToolInvocation) => ({ ok: true }));
        const secondInvoker = vi.fn(async (_invocation: NestedToolInvocation) => ({ ok: true }));

        const first = (await exec!.execute({ input: "yield_control()" } as never, context, {
            invokeTool: firstInvoker,
            toolCallId: "exec-1",
        })) as { cellId: string };
        const second = (await exec!.execute({ input: "yield_control()" } as never, context, {
            invokeTool: firstInvoker,
            toolCallId: "exec-2",
        })) as { cellId: string };
        const inactiveTool = cells.get(first.cellId)?.[0];
        await expect(
            Promise.resolve().then(() =>
                inactiveTool?.execute(
                    { value: "inactive" },
                    {
                        cellId: first.cellId,
                        runtimeToolCallId: "tool-1",
                        signal: new AbortController().signal,
                        toolKind: "function",
                        toolName: { name: "inspect" },
                    },
                ),
            ),
        ).rejects.toThrow("only while exec or wait is active");

        await wait!.execute({ cell_id: first.cellId } as never, context, {
            invokeTool: secondInvoker,
            toolCallId: "wait-1",
        });
        await wait!.execute({ cell_id: second.cellId } as never, context, {
            invokeTool: secondInvoker,
            toolCallId: "wait-2",
        });

        expect(firstInvoker).not.toHaveBeenCalled();
        expect(secondInvoker.mock.calls.map(([invocation]) => invocation.toolCallId)).toEqual([
            "codemode:cell-1:tool-1",
            "codemode:cell-2:tool-1",
        ]);
    });
});

function tool(name: string, execution: "durable" | "immediate" = "immediate") {
    return defineTool({
        name,
        label: name,
        description: `${name} description`,
        arguments: Type.Object({ value: Type.Optional(Type.String()) }),
        returnType: Type.Object({ ok: Type.Boolean() }),
        execution,
        shouldReviewInAutoMode: () => false,
        execute: () => ({ ok: true }),
        toLLM: (result) => [{ type: "text" as const, text: JSON.stringify(result) }],
        toUI: () => name,
        locks: [],
    });
}
