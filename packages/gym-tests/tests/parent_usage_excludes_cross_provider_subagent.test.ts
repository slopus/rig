import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const artifacts = resolve(import.meta.dirname, "../../artifacts/session-usage");

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("parent session usage", () => {
    it("excludes a cross-provider subagent's inference", async () => {
        await mkdir(artifacts, { recursive: true });
        const gym = await createGym({
            inference(request) {
                const isParent = request.providerId === "gym";
                const last = JSON.stringify(request.context.messages.at(-1));
                if (!isParent) {
                    expect(request.providerId).toBe("claude");
                    return {
                        content: [{ text: "CROSS_PROVIDER_CHILD_DONE", type: "text" }],
                        usage: usage(900),
                    };
                }
                if (last.includes("Delegate the usage-heavy audit")) {
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    message: "Complete the cross-provider audit.",
                                    model: "anthropic/sonnet-4-6",
                                    provider: "claude",
                                    task_name: "usage_heavy_child",
                                },
                                id: "spawn-usage-heavy-child",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                        usage: usage(100),
                    };
                }
                if (last.includes("<subagent-notification>")) {
                    return {
                        content: [{ text: "PARENT_ACKNOWLEDGED_CHILD", type: "text" }],
                        usage: usage(25),
                    };
                }
                return {
                    content: [{ text: "PARENT_CONTINUED", type: "text" }],
                    usage: usage(50),
                };
            },
            providerOverrides: ["claude"],
            rows: 25,
        });
        running.add(gym);

        submit(gym, "Delegate the usage-heavy audit.");
        await gym.terminal.waitForText("PARENT_ACKNOWLEDGED_CHILD", 30_000);
        submit(gym, "/usage");
        const report = await gym.terminal.waitForText("Session total: 175", 30_000);
        expect(report.text).toContain("175 total · 0 input · 175 output");
        expect(report.text).not.toMatch(/Claude\s+\S+\s+\d+ total/u);
        await gym.terminal.screenshot(`${artifacts}/parent-excludes-cross-provider-subagent.png`);
    }, 120_000);
});

function usage(output: number) {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output,
        totalTokens: output,
    };
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
