import { describe, expect, it, vi } from "vitest";

import type { InMemorySession } from "./InMemorySession.js";
import { AgentSessionManager } from "./AgentSessionManager.js";

describe("AgentSessionManager", () => {
    it("uses a requested model for a workflow child while inheriting the remaining session settings", async () => {
        const child = {
            agentMetadata: () => ({
                depth: 1,
                parentSessionId: "root-1",
                rootSessionId: "root-1",
                taskName: "model_check",
                type: "subagent" as const,
            }),
            id: "child-1",
            isSubagent: () => true,
            subagentSummary: () => ({ status: "running" }),
            submit: vi.fn(() => ({ runId: "child-run" })),
        } as unknown as InMemorySession;
        const parent = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "root-1", type: "primary" }),
            id: "root-1",
            hasModel: (modelId: string, providerId?: string) =>
                modelId === "anthropic/claude-opus-4.6" && providerId === "claude-sdk",
            isSubagent: () => false,
            recordSubagentChanged: vi.fn(),
            requestForSubagent: () => ({
                cwd: "/tmp/rig-manager-test",
                instructions: "Inherited instructions",
                modelId: "openai/gpt-5.5",
                permissionMode: "auto",
                providerId: "codex",
            }),
        } as unknown as InMemorySession;
        const createSubagent = vi.fn(() => child);
        const manager = new AgentSessionManager({
            repository: {
                createSubagent,
                get: (sessionId) => (sessionId === parent.id ? parent : undefined),
                listByRoot: () => [],
            },
        });

        await manager.spawn(parent.id, {
            background: true,
            description: "Check another model",
            modelId: "anthropic/claude-opus-4.6",
            providerId: "claude-sdk",
            prompt: "Inspect with the requested model.",
            taskName: "model_check",
        });

        expect(createSubagent).toHaveBeenCalledWith(
            expect.objectContaining({
                cwd: "/tmp/rig-manager-test",
                instructions: expect.stringContaining("Inherited instructions"),
                modelId: "anthropic/claude-opus-4.6",
                permissionMode: "auto",
                providerId: "claude-sdk",
            }),
            expect.objectContaining({ taskName: "model_check" }),
        );
        await expect(
            manager.spawn(parent.id, {
                description: "Unknown model",
                modelId: "missing/model",
                providerId: "claude-sdk",
                prompt: "This should not start.",
            }),
        ).rejects.toThrow("Model 'missing/model' is not available for provider 'claude-sdk'.");
        expect(createSubagent).toHaveBeenCalledOnce();
    });

    it("updates every subagent permission boundary with the root session", async () => {
        const changeFirst = vi.fn(async () => ({ permissionMode: "read_only" }));
        const changeSecond = vi.fn(async () => ({ permissionMode: "read_only" }));
        const root = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "root-1", type: "primary" }),
            id: "root-1",
            isSubagent: () => false,
        } as unknown as InMemorySession;
        const children = [changeFirst, changeSecond].map(
            (changePermissionMode, index) =>
                ({
                    changePermissionMode,
                    id: `child-${index + 1}`,
                }) as unknown as InMemorySession,
        );
        const manager = new AgentSessionManager({
            repository: {
                createSubagent: vi.fn(),
                get: (sessionId) => (sessionId === root.id ? root : undefined),
                listByRoot: () => children,
            },
        });

        await manager.changeSubagentPermissionModes(root.id, "read_only");

        expect(changeFirst).toHaveBeenCalledWith(
            { permissionMode: "read_only" },
            { updateSubagents: false },
        );
        expect(changeSecond).toHaveBeenCalledWith(
            { permissionMode: "read_only" },
            { updateSubagents: false },
        );
    });

    it("runs background agents, reports completion, and keeps them available for follow-up", async () => {
        let status: "completed" | "running" = "running";
        let resolveCompletion: ((value: { status: "completed" }) => void) | undefined;
        const completion = new Promise<{ status: "completed" }>((resolve) => {
            resolveCompletion = resolve;
        });
        const childSubmit = vi
            .fn()
            .mockReturnValueOnce({ eventId: "event-1", runId: "run-1", sessionId: "child-1" })
            .mockReturnValueOnce({ eventId: "event-2", runId: "run-2", sessionId: "child-1" });
        const abort = vi.fn(() => ({ aborted: true }));
        const child = {
            abort,
            agentMetadata: () => ({
                depth: 1,
                description: "Inspect code",
                parentSessionId: "root-1",
                rootSessionId: "root-1",
                taskName: "inspect_code",
                type: "subagent" as const,
            }),
            id: "child-1",
            isSubagent: () => true,
            snapshot: () => ({
                snapshot: {
                    messages: [
                        {
                            blocks: [{ text: "The inspection is complete.", type: "text" }],
                            id: "message-1",
                            role: "agent",
                        },
                    ],
                },
            }),
            subagentSummary: () => ({
                agentId: "agent-2",
                createdAt: 2,
                depth: 1,
                description: "Inspect code",
                id: "child-1",
                modelId: "openai/gpt-5.5",
                parentSessionId: "root-1",
                status,
                taskName: "inspect_code",
                updatedAt: 3,
            }),
            submit: childSubmit,
            waitForRun: () => completion,
        } as unknown as InMemorySession;
        const deliverNotification = vi.fn();
        const parent = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "root-1", type: "primary" }),
            deliverNotification,
            id: "root-1",
            isSubagent: () => false,
            recordSubagentChanged: vi.fn(),
            requestForSubagent: () => ({
                cwd: "/tmp/rig-manager-test",
                modelId: "openai/gpt-5.5",
            }),
        } as unknown as InMemorySession;
        let created = false;
        const sessions = new Map([
            ["root-1", parent],
            ["child-1", child],
        ]);
        const manager = new AgentSessionManager({
            repository: {
                createSubagent: () => {
                    created = true;
                    return child;
                },
                get: (sessionId) => sessions.get(sessionId),
                listByRoot: () => (created ? [child] : []),
            },
        });

        await expect(
            manager.spawn("root-1", {
                background: true,
                description: "Inspect code",
                prompt: "Inspect the codebase.",
                taskName: "inspect_code",
            }),
        ).resolves.toMatchObject({
            path: "/root/inspect_code",
            sessionId: "child-1",
            status: "running",
            taskName: "inspect_code",
        });
        expect(manager.list("root-1")).toEqual([
            expect.objectContaining({ path: "/root/inspect_code", status: "running" }),
        ]);

        status = "completed";
        resolveCompletion?.({ status: "completed" });
        await vi.waitFor(() => expect(deliverNotification).toHaveBeenCalledOnce());
        expect(deliverNotification).toHaveBeenCalledWith({
            displayText: 'Background work "Inspect code" completed.',
            text: expect.stringContaining("The inspection is complete."),
        });

        expect(manager.followUp("root-1", "inspect_code", "Check one more file.")).toMatchObject({
            sessionId: "child-1",
        });
        expect(childSubmit).toHaveBeenLastCalledWith({ text: "Check one more file." });
        expect(manager.interrupt("root-1", "/root/inspect_code")).toMatchObject({
            status: "completed",
        });
        expect(abort).toHaveBeenCalledOnce();
        await expect(manager.wait("root-1", 0)).resolves.toMatchObject({
            agents: [expect.objectContaining({ taskName: "inspect_code" })],
            timedOut: false,
        });
    });

    it("delivers each background completion immediately", async () => {
        const completions = new Map<string, (value: { status: "completed" }) => void>();
        const statuses = new Map<string, "completed" | "running">();
        const children = ["child-1", "child-2"].map((id, index) => {
            const taskName = `task_${index + 1}`;
            statuses.set(id, "running");
            const completion = new Promise<{ status: "completed" }>((resolve) => {
                completions.set(id, resolve);
            });
            return {
                agentMetadata: () => ({
                    depth: 1,
                    description: taskName,
                    parentSessionId: "root-1",
                    rootSessionId: "root-1",
                    taskName,
                    type: "subagent" as const,
                }),
                id,
                isSubagent: () => true,
                snapshot: () => ({
                    snapshot: {
                        messages: [
                            {
                                blocks: [{ text: `${taskName} result`, type: "text" }],
                                id: `${id}-message`,
                                role: "agent",
                            },
                        ],
                    },
                }),
                subagentSummary: () => ({
                    agentId: `${id}-agent`,
                    createdAt: index,
                    depth: 1,
                    description: taskName,
                    id,
                    modelId: "openai/gpt-5.5",
                    parentSessionId: "root-1",
                    status: statuses.get(id) ?? "running",
                    taskName,
                    updatedAt: index,
                }),
                submit: vi.fn(() => ({
                    eventId: `${id}-event`,
                    runId: `${id}-run`,
                    sessionId: id,
                })),
                waitForRun: () => completion,
            } as unknown as InMemorySession;
        });
        const deliverNotification = vi.fn();
        const parent = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "root-1", type: "primary" }),
            deliverNotification,
            id: "root-1",
            isSubagent: () => false,
            recordSubagentChanged: vi.fn(),
            requestForSubagent: () => ({
                cwd: "/tmp/rig-manager-test",
                modelId: "openai/gpt-5.5",
            }),
        } as unknown as InMemorySession;
        const sessions = new Map<string, InMemorySession>([["root-1", parent]]);
        let nextChild = 0;
        const manager = new AgentSessionManager({
            repository: {
                createSubagent: () => {
                    const child = children[nextChild++];
                    if (child === undefined) throw new Error("No child session available.");
                    sessions.set(child.id, child);
                    return child;
                },
                get: (sessionId) => sessions.get(sessionId),
                listByRoot: () => children.slice(0, nextChild),
            },
        });

        await Promise.all([
            manager.spawn("root-1", {
                background: true,
                description: "First task",
                prompt: "Do the first task.",
                taskName: "task_1",
            }),
            manager.spawn("root-1", {
                background: true,
                description: "Second task",
                prompt: "Do the second task.",
                taskName: "task_2",
            }),
        ]);

        statuses.set("child-1", "completed");
        statuses.set("child-2", "completed");
        completions.get("child-1")?.({ status: "completed" });
        completions.get("child-2")?.({ status: "completed" });

        await vi.waitFor(() => expect(deliverNotification).toHaveBeenCalledTimes(2));
        expect(deliverNotification).toHaveBeenNthCalledWith(1, {
            displayText: 'Background work "task_1" completed.',
            text: expect.stringContaining("task_1 result"),
        });
        expect(deliverNotification).toHaveBeenNthCalledWith(2, {
            displayText: 'Background work "task_2" completed.',
            text: expect.stringContaining("task_2 result"),
        });
    });

    it("cascades the parent step abort into the active child", async () => {
        let childStatus: "aborted" | "running" = "running";
        let resolveCompletion: ((value: { status: "aborted" }) => void) | undefined;
        const completion = new Promise<{ status: "aborted" }>((resolve) => {
            resolveCompletion = resolve;
        });
        const abort = vi.fn(() => {
            childStatus = "aborted";
            resolveCompletion?.({ status: "aborted" });
            return { aborted: true };
        });
        const child = {
            abort,
            agentMetadata: () => ({
                depth: 1,
                description: "Inspect the code",
                parentSessionId: "session-1",
                rootSessionId: "session-1",
                taskName: "inspect_code",
                type: "subagent" as const,
            }),
            id: "subagent-1",
            isSubagent: () => true,
            snapshot: () => ({ snapshot: { messages: [] } }),
            subagentSummary: () => ({
                agentId: "agent-2",
                createdAt: 2,
                depth: 1,
                description: "Inspect the code",
                id: "subagent-1",
                modelId: "openai/gpt-5.5",
                parentSessionId: "session-1",
                status: childStatus,
                updatedAt: 3,
            }),
            submit: () => ({ eventId: "event-1", runId: "run-1", sessionId: "subagent-1" }),
            waitForRun: () => completion,
        } as unknown as InMemorySession;
        const recordSubagentChanged = vi.fn();
        const parent = {
            id: "session-1",
            agentMetadata: () => ({
                depth: 0,
                rootSessionId: "session-1",
                type: "primary" as const,
            }),
            isSubagent: () => false,
            recordSubagentChanged,
            requestForSubagent: () => ({
                cwd: "/tmp/rig-manager-test",
                modelId: "openai/gpt-5.5",
            }),
        } as unknown as InMemorySession;
        const manager = new AgentSessionManager({
            repository: {
                createSubagent: () => child,
                get: (sessionId) => (sessionId === "subagent-1" ? child : parent),
                listByRoot: () => [],
            },
        });
        const controller = new AbortController();

        const run = manager.spawn(
            "session-1",
            { description: "Inspect the code", prompt: "Review the implementation." },
            controller.signal,
        );
        controller.abort();

        await expect(run).resolves.toMatchObject({
            sessionId: "subagent-1",
            status: "aborted",
        });
        expect(abort).toHaveBeenCalledOnce();
        expect(recordSubagentChanged).toHaveBeenCalledTimes(2);
    });

    it("suspends active descendants until each retained session is explicitly resumed", async () => {
        const statuses = new Map<string, "aborted" | "completed" | "running" | "suspended">([
            ["child-1", "running"],
            ["grandchild-1", "running"],
            ["child-2", "completed"],
        ]);
        const sessions = new Map<string, InMemorySession>();
        const makeChild = (
            id: string,
            parentSessionId: string,
            depth: number,
            taskName: string,
        ) => {
            const abort = vi.fn(() => {
                statuses.set(id, "aborted");
                return { aborted: true };
            });
            const suspendByParent = vi.fn(() => {
                statuses.set(id, "suspended");
            });
            const submit = vi.fn(() => {
                statuses.set(id, "running");
                return { eventId: `${id}-event`, runId: `${id}-run`, sessionId: id };
            });
            const resumeSuspended = vi.fn(() => {
                statuses.set(id, "running");
                return { eventId: `${id}-resume-event`, runId: `${id}-resume-run`, sessionId: id };
            });
            const session = {
                abort,
                agentMetadata: () => ({
                    depth,
                    description: taskName,
                    parentSessionId,
                    rootSessionId: "root-1",
                    taskName,
                    type: "subagent" as const,
                }),
                id,
                isSubagent: () => true,
                clearSuspension: vi.fn(() => {
                    if (statuses.get(id) === "suspended") statuses.set(id, "aborted");
                }),
                recordSubagentChanged: vi.fn(),
                resumeSuspended,
                snapshot: () => ({ snapshot: { messages: [] } }),
                subagentSummary: () => ({
                    agentId: `${id}-agent`,
                    createdAt: depth,
                    depth,
                    description: taskName,
                    id,
                    modelId: "openai/gpt-5.5",
                    parentSessionId,
                    status: statuses.get(id),
                    taskName,
                    updatedAt: depth,
                }),
                submit,
                suspendByParent,
                waitForRun: () => new Promise(() => undefined),
            } as unknown as InMemorySession;
            sessions.set(id, session);
            return { abort, resumeSuspended, session, submit, suspendByParent };
        };
        const root = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "root-1", type: "primary" }),
            id: "root-1",
            isSubagent: () => false,
            recordSubagentChanged: vi.fn(),
            recordSubagentsSuspended: vi.fn(),
        } as unknown as InMemorySession;
        sessions.set(root.id, root);
        const child = makeChild("child-1", root.id, 1, "audit_code");
        const grandchild = makeChild("grandchild-1", child.session.id, 2, "inspect_tests");
        const completed = makeChild("child-2", root.id, 1, "finished_task");
        const manager = new AgentSessionManager({
            repository: {
                createSubagent: vi.fn(),
                get: (sessionId) => sessions.get(sessionId),
                listByRoot: () => [child.session, grandchild.session, completed.session],
            },
        });

        await expect(manager.pauseDescendants(root.id)).resolves.toBe(2);

        expect(child.suspendByParent).toHaveBeenCalledOnce();
        expect(grandchild.suspendByParent).toHaveBeenCalledOnce();
        expect(completed.abort).not.toHaveBeenCalled();
        expect(manager.list(root.id)).toEqual([
            expect.objectContaining({ sessionId: child.session.id, status: "suspended" }),
            expect.objectContaining({ sessionId: grandchild.session.id, status: "suspended" }),
            expect.objectContaining({ sessionId: completed.session.id, status: "completed" }),
        ]);
        expect(root.recordSubagentsSuspended).toHaveBeenCalledWith([
            expect.objectContaining({ sessionId: child.session.id, status: "suspended" }),
            expect.objectContaining({ sessionId: grandchild.session.id, status: "suspended" }),
        ]);

        expect(manager.resume(root.id, "audit_code")).toEqual(
            expect.objectContaining({ sessionId: child.session.id, status: "running" }),
        );

        expect(child.resumeSuspended).toHaveBeenCalledOnce();
        expect(grandchild.resumeSuspended).not.toHaveBeenCalled();
        expect(completed.submit).not.toHaveBeenCalled();
        expect(manager.list(root.id)).toEqual([
            expect.objectContaining({ sessionId: child.session.id, status: "running" }),
            expect.objectContaining({ sessionId: grandchild.session.id, status: "suspended" }),
            expect.objectContaining({ sessionId: completed.session.id, status: "completed" }),
        ]);
    });

    it("does not suspend children owned by a workflow that is still running", async () => {
        const suspendByParent = vi.fn();
        const workflowChild = {
            agentMetadata: () => ({
                depth: 1,
                description: "Workflow child",
                parentSessionId: "root-1",
                rootSessionId: "root-1",
                taskName: "workflow_run-1_1",
                type: "subagent" as const,
            }),
            id: "workflow-child-1",
            isSubagent: () => true,
            subagentSummary: () => ({ status: "running" }),
            suspendByParent,
        } as unknown as InMemorySession;
        const root = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "root-1", type: "primary" }),
            getWorkflow: (runId: string) =>
                runId === "run-1" ? ({ status: "running" } as const) : undefined,
            id: "root-1",
            recordSubagentsSuspended: vi.fn(),
        } as unknown as InMemorySession;
        const manager = new AgentSessionManager({
            repository: {
                createSubagent: vi.fn(),
                get: (sessionId) =>
                    sessionId === root.id
                        ? root
                        : sessionId === workflowChild.id
                          ? workflowChild
                          : undefined,
                listByRoot: () => [workflowChild],
            },
        });

        await expect(manager.pauseDescendants(root.id)).resolves.toBe(0);
        expect(suspendByParent).not.toHaveBeenCalled();
        expect(root.recordSubagentsSuspended).toHaveBeenCalledWith([]);
    });

    it("waits for active work instead of returning an older completed agent", async () => {
        let activeStatus: "completed" | "running" = "running";
        const makeChild = (id: string, taskName: string, status: () => "completed" | "running") =>
            ({
                agentMetadata: () => ({
                    depth: 1,
                    description: taskName,
                    parentSessionId: "root-1",
                    rootSessionId: "root-1",
                    taskName,
                    type: "subagent" as const,
                }),
                id,
                isSubagent: () => true,
                subagentSummary: () => ({
                    agentId: `${id}-agent`,
                    createdAt: 1,
                    depth: 1,
                    description: taskName,
                    id,
                    modelId: "openai/gpt-5.5",
                    parentSessionId: "root-1",
                    status: status(),
                    taskName,
                    updatedAt: 2,
                }),
            }) as unknown as InMemorySession;
        const completed = makeChild("child-1", "older_task", () => "completed");
        const active = makeChild("child-2", "active_task", () => activeStatus);
        const root = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "root-1", type: "primary" }),
            id: "root-1",
            isSubagent: () => false,
        } as unknown as InMemorySession;
        const manager = new AgentSessionManager({
            repository: {
                createSubagent: vi.fn(),
                get: (sessionId) =>
                    sessionId === "root-1" ? root : sessionId === "child-1" ? completed : active,
                listByRoot: () => [completed, active],
            },
        });
        let settled = false;
        const waiting = manager.wait("root-1", 500).then((result) => {
            settled = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(settled).toBe(false);
        activeStatus = "completed";

        await expect(waiting).resolves.toEqual({
            agents: [expect.objectContaining({ sessionId: "child-2", status: "completed" })],
            timedOut: false,
        });
    });

    it("rejects a child beyond the configured nesting depth", async () => {
        const parent = {
            agentMetadata: () => ({
                depth: 3,
                parentSessionId: "subagent-2",
                rootSessionId: "session-1",
                type: "subagent" as const,
            }),
        } as unknown as InMemorySession;
        const createSubagent = vi.fn();
        const manager = new AgentSessionManager({
            maxDepth: 3,
            repository: {
                createSubagent,
                get: () => parent,
                listByRoot: () => [],
            },
        });

        await expect(
            manager.spawn("subagent-3", {
                description: "Exceed the limit",
                prompt: "Start another child.",
            }),
        ).rejects.toThrow("limited to 3 nested levels");
        expect(createSubagent).not.toHaveBeenCalled();
    });

    it("rejects a spawn when the active-agent limit is full", async () => {
        const parent = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "root-1", type: "primary" }),
            id: "root-1",
        } as unknown as InMemorySession;
        const active = Array.from({ length: 4 }, (_, index) => {
            const id = `child-${index + 1}`;
            return {
                subagentSummary: () => ({
                    agentId: `${id}-agent`,
                    createdAt: index,
                    depth: 1,
                    description: `Active task ${index + 1}`,
                    id,
                    modelId: "openai/gpt-5.5",
                    parentSessionId: "root-1",
                    status: "running" as const,
                    updatedAt: index,
                }),
            } as unknown as InMemorySession;
        });
        const createSubagent = vi.fn();
        const manager = new AgentSessionManager({
            repository: {
                createSubagent,
                get: () => parent,
                listByRoot: () => active,
            },
        });

        await expect(
            manager.spawn("root-1", {
                description: "One task too many",
                prompt: "Do more work.",
            }),
        ).rejects.toThrow("No more than 4 subagents can run at once");
        expect(createSubagent).not.toHaveBeenCalled();
    });

    it("queues workflow agents until an active-agent slot is available", async () => {
        let activeStatus: "completed" | "running" = "running";
        const parent = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "root-1", type: "primary" }),
            id: "root-1",
            isSubagent: () => false,
            recordSubagentChanged: vi.fn(),
            requestForSubagent: () => ({
                cwd: "/tmp/rig-manager-test",
                modelId: "openai/gpt-5.5",
            }),
        } as unknown as InMemorySession;
        const active = {
            agentMetadata: () => ({
                depth: 1,
                description: "Active task",
                parentSessionId: "root-1",
                rootSessionId: "root-1",
                taskName: "active_task",
                type: "subagent" as const,
            }),
            subagentSummary: () => ({
                agentId: "active-agent",
                createdAt: 1,
                depth: 1,
                description: "Active task",
                id: "active-child",
                modelId: "openai/gpt-5.5",
                parentSessionId: "root-1",
                status: activeStatus,
                updatedAt: 1,
            }),
        } as unknown as InMemorySession;
        const queued = {
            abort: vi.fn(),
            agentMetadata: () => ({
                depth: 1,
                description: "Queued task",
                parentSessionId: "root-1",
                rootSessionId: "root-1",
                taskName: "queued_task",
                type: "subagent" as const,
            }),
            id: "queued-child",
            isSubagent: () => true,
            snapshot: () => ({
                snapshot: {
                    messages: [
                        {
                            blocks: [{ text: "Queued result", type: "text" }],
                            id: "result",
                            role: "agent",
                        },
                    ],
                },
            }),
            subagentSummary: () => ({
                agentId: "queued-agent",
                createdAt: 2,
                depth: 1,
                description: "Queued task",
                id: "queued-child",
                modelId: "openai/gpt-5.5",
                parentSessionId: "root-1",
                status: "completed" as const,
                taskName: "queued_task",
                updatedAt: 2,
            }),
            submit: vi.fn(() => ({ eventId: "event", runId: "run", sessionId: "queued-child" })),
            waitForRun: vi.fn(async () => ({ status: "completed" as const })),
        } as unknown as InMemorySession;
        let created = false;
        const createSubagent = vi.fn(() => {
            created = true;
            return queued;
        });
        const manager = new AgentSessionManager({
            maxActive: 1,
            repository: {
                createSubagent,
                get: () => parent,
                listByRoot: () => (created ? [active, queued] : [active]),
            },
        });

        const spawning = manager.spawn("root-1", {
            description: "Queued task",
            prompt: "Run after the active task.",
            taskName: "queued_task",
            waitForSlot: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(createSubagent).not.toHaveBeenCalled();

        activeStatus = "completed";

        await expect(spawning).resolves.toMatchObject({
            output: "Queued result",
            status: "completed",
            taskName: "queued_task",
        });
        expect(createSubagent).toHaveBeenCalledOnce();
    });

    it("routes subagent task operations to the root session", () => {
        const root = {
            agentMetadata: () => ({ depth: 0, rootSessionId: "session-1", type: "primary" }),
        } as unknown as InMemorySession;
        const child = {
            agentMetadata: () => ({
                depth: 1,
                rootSessionId: "session-1",
                type: "subagent",
            }),
        } as unknown as InMemorySession;
        const sessions = new Map([
            ["session-1", root],
            ["subagent-1", child],
        ]);
        const manager = new AgentSessionManager({
            repository: {
                createSubagent: () => child,
                get: (sessionId) => sessions.get(sessionId),
                listByRoot: () => [child],
            },
        });

        expect(manager.taskSession("subagent-1")).toBe(root);
        expect(manager.taskSession("session-1")).toBe(root);
    });
});
