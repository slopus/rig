import { describe, expect, it } from "vitest";

import type { ProtocolSession } from "../protocol/index.js";
import { ensureSessionCanResume } from "./ensureSessionCanResume.js";

describe("ensureSessionCanResume", () => {
    it("rejects attempts to resume a subagent history", () => {
        expect(() => ensureSessionCanResume(subagentSession())).toThrow(
            "Subagent histories are read-only",
        );
    });
});

function subagentSession(): ProtocolSession {
    return {
        agent: {
            depth: 1,
            description: "Inspect the code",
            parentSessionId: "session-1",
            rootSessionId: "session-1",
            type: "subagent",
        },
        agentId: "agent-2",
        cwd: "/tmp/rig-resume-test",
        id: "subagent-1",
        modelId: "openai/gpt-5.5",
        modelLocked: true,
        models: [],
        providerId: "codex",
        permissionMode: "workspace_write",
        mcpServers: [],
        pendingUserInputs: [],
        tasks: [],
        snapshot: {
            id: "agent-2",
            messages: [],
            modelId: "openai/gpt-5.5",
            providerId: "codex",
            queue: [],
            status: "idle",
            tools: [],
        },
        status: "completed",
        titleStatus: "ready",
    };
}
