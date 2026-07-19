import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const rig = "node /app/packages/rig/dist/main.js";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Kimi K3 model switching", () => {
    it("rebuilds provider prompts and tools, persists Codex, then switches back to Kimi", async () => {
        let agentCallIndex = 0;
        const gym = await createGym({
            mode: "docker",
            entrypoint: [
                "bash",
                "-lc",
                `${rig}; echo KIMI_SWITCH_RESUMED; exec ${rig} resume --last`,
            ],
            inference(request) {
                if (request.options.sessionId?.endsWith(":title") === true) {
                    return { content: [{ text: "Kimi switch", type: "text" }] };
                }
                const callIndex = agentCallIndex++;
                if (callIndex === 0) {
                    expect(request.providerId).toBe("kimi");
                    expect(request.options.thinking).toBe("max");
                    expect(request.context.systemPrompt).toContain(
                        "You are Kimi Code, operating as Rig",
                    );
                    expect(request.context.tools?.map((tool) => tool.name)).toContain("Read");
                    expect(
                        request.context.tools?.find((tool) => tool.name === "Read")?.description,
                    ).toContain("If the user provides a concrete file path, call Read directly");
                    return {
                        content: [
                            { thinking: "Kimi reasoning retained.", type: "thinking" },
                            { text: "KIMI_INITIAL_TURN", type: "text" },
                        ],
                    };
                }
                if (callIndex === 1 || callIndex === 2) {
                    expect(request.providerId).toBe("codex");
                    expect(request.modelId).toBe("openai/gpt-5.6-sol");
                    expect(request.options.thinking).toBe("low");
                    expect(request.context.systemPrompt).not.toContain(
                        "You are Kimi Code, operating as Rig",
                    );
                    expect(
                        request.context.tools?.find((tool) => tool.name === "Read")?.description ??
                            "",
                    ).not.toContain(
                        "If the user provides a concrete file path, call Read directly",
                    );
                    expect(JSON.stringify(request.context.messages)).toContain("KIMI_INITIAL_TURN");
                    return {
                        content: [
                            {
                                encrypted: JSON.stringify({
                                    id: `reasoning-${callIndex}`,
                                    type: "reasoning",
                                }),
                                thinking: "Codex reasoning.",
                                type: "thinking",
                            },
                            {
                                text: callIndex === 1 ? "CODEX_AFTER_SWITCH" : "CODEX_AFTER_RESUME",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(3);
                expect(request.providerId).toBe("kimi");
                expect(request.options.thinking).toBe("max");
                expect(request.context.systemPrompt).toContain(
                    "You are Kimi Code, operating as Rig",
                );
                expect(request.context.tools?.map((tool) => tool.name)).toContain("Read");
                expect(
                    request.context.tools?.find((tool) => tool.name === "Read")?.description,
                ).toContain("If the user provides a concrete file path, call Read directly");
                const history = JSON.stringify(request.context.messages);
                expect(history).toContain("CODEX_AFTER_SWITCH");
                expect(history).toContain("CODEX_AFTER_RESUME");
                return { content: [{ text: "KIMI_AFTER_SWITCH_BACK", type: "text" }] };
            },
            providerId: "kimi",
            providerOverrides: ["kimi", "codex"],
            rows: 28,
        });
        running.add(gym);

        submit(gym, "Start with Kimi.");
        await gym.terminal.waitForText("KIMI_INITIAL_TURN", 30_000);

        submit(gym, "/model");
        await gym.terminal.waitForText("Choose Model", 30_000);
        gym.terminal.press("down");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Choose Reasoning", 30_000);
        gym.terminal.press("enter");
        await gym.terminal.waitForText("gpt-5.6-sol low · /workspace", 30_000);

        submit(gym, "Continue with Codex.");
        await gym.terminal.waitForText("CODEX_AFTER_SWITCH", 30_000);
        gym.terminal.press("ctrlD");
        await gym.terminal.waitForText("KIMI_SWITCH_RESUMED", 30_000);
        await gym.terminal.waitForText("gpt-5.6-sol low · /workspace", 30_000);
        submit(gym, "Verify Codex after resume.");
        await gym.terminal.waitForText("CODEX_AFTER_RESUME", 30_000);

        submit(gym, "/model");
        await gym.terminal.waitForText("Choose Model", 30_000);
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Choose Reasoning", 30_000);
        gym.terminal.press("enter");
        await gym.terminal.waitForText("kimi-k3 max · /workspace", 30_000);
        submit(gym, "Switch back to Kimi.");
        const result = await gym.terminal.waitForText("KIMI_AFTER_SWITCH_BACK", 30_000);
        expect(result.text).toContain("kimi-k3 max");
        expect(agentCallIndex).toBe(4);
    }, 180_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
