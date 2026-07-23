import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCodingAssistantAgent } from "../runtime/createCodingAssistantAgent.js";
import { modelOpenaiGpt56Sol } from "@slopus/rig-execution";

const LIVE = process.env.RIG_LIVE_TEST === "1";
const CODEX_AUTH_PATH = path.join(homedir(), ".codex", "auth.json");

function hasLocalCodexAuth(): boolean {
    if (!existsSync(CODEX_AUTH_PATH)) return false;
    try {
        const data = JSON.parse(readFileSync(CODEX_AUTH_PATH, "utf8")) as {
            tokens?: { access_token?: unknown };
        };
        return (
            typeof data.tokens?.access_token === "string" &&
            data.tokens.access_token.trim().length > 0
        );
    } catch {
        return false;
    }
}

const describeLive = LIVE && hasLocalCodexAuth() ? describe : describe.skip;

describeLive("configured Codex provider live", () => {
    it("accepts Rig's provider-neutral agent namespace", async () => {
        let spawnCount = 0;
        const managed = {
            description: "Live Rig probe",
            path: "/root/live_rig_probe",
            sessionId: "live-rig-subagent",
            status: "completed" as const,
            taskName: "live_rig_probe",
        };
        const runtime = createCodingAssistantAgent({
            cwd: process.cwd(),
            modelId: modelOpenaiGpt56Sol.id,
            subagents: {
                canSpawn: true,
                depth: 0,
                followUp: () => managed,
                interrupt: () => managed,
                list: () => [managed],
                maxDepth: 3,
                spawn: async () => {
                    spawnCount += 1;
                    return { ...managed, output: "ok" };
                },
                wait: async () => ({ agents: [managed], timedOut: false }),
            },
        });

        try {
            runtime.agent.enqueueUserMessage(
                "Call rig.spawn_agent exactly once, then reply exactly: live rig ok",
            );
            const result = await runtime.agent.run();
            if (result.stopReason === "error") {
                throw new Error(result.errorMessage ?? "Codex inference failed.");
            }
            expect(spawnCount).toBe(1);
        } finally {
            await runtime.agent.close();
        }
    }, 120_000);

    it("sends priority inference with the exact reserved collaboration schema", async () => {
        const managed = {
            description: "Live probe",
            path: "/root/live_probe",
            sessionId: "live-subagent",
            status: "completed" as const,
            taskName: "live_probe",
        };
        const runtime = createCodingAssistantAgent({
            cwd: process.cwd(),
            modelId: modelOpenaiGpt56Sol.id,
            serviceTier: "fast",
            subagents: {
                canSpawn: true,
                depth: 0,
                followUp: () => managed,
                interrupt: () => managed,
                list: () => [managed],
                maxDepth: 3,
                spawn: async () => ({ ...managed, output: "ok" }),
                wait: async () => ({ agents: [managed], timedOut: false }),
            },
        });

        try {
            runtime.agent.enqueueUserMessage("Reply with exactly: live collaboration schema ok");
            const result = await runtime.agent.run();
            if (result.stopReason === "error") {
                throw new Error(result.errorMessage ?? "Codex inference failed.");
            }
        } finally {
            await runtime.agent.close();
        }
    }, 120_000);
});

describe.skipIf(!LIVE || hasLocalCodexAuth())(
    "configured Codex provider live prerequisites",
    () => {
        it("documents how to run the live test", () => {
            if (LIVE) {
                expect.fail(
                    "RIG_LIVE_TEST=1 is set but ~/.codex/auth.json is missing a usable access_token",
                );
            }
        });
    },
);
