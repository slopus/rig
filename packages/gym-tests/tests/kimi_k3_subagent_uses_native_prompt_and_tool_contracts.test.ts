import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";
import type { Tool } from "../../rig/sources/providers/types.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Kimi K3 subagent contracts", () => {
    it("delegates through Kimi's Agent contract and gives the child its native handoff overlay", async () => {
        let parentSessionId: string | undefined;
        let childVerified = false;
        let parentCompleted = false;
        const gym = await createGym({
            homeFiles: {
                ".kimi-code/credentials/kimi-code.json": JSON.stringify({
                    access_token: "kimi-test-token",
                    refresh_token: "kimi-refresh-token",
                }),
            },
            inference(request) {
                if (request.options.sessionId?.endsWith(":title") === true) {
                    return { content: [{ text: "Kimi subagent", type: "text" }] };
                }
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
                expect(request.providerId).toBe("kimi");
                expect(request.modelId).toBe("moonshot/kimi-k3");
                expect(request.options.thinking).toBe("max");
                assertKimiToolContracts(request.context.tools ?? []);

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    expect(request.context.systemPrompt).toContain(
                        "You are Kimi Code, operating as Rig",
                    );
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    description: "Inspect the Kimi child contract",
                                    prompt: "Return CHILD_KIMI_OK after inspecting your instructions.",
                                    run_in_background: false,
                                },
                                id: "kimi-agent-contract-call",
                                name: "Agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (sessionId !== parentSessionId) {
                    expect(request.context.systemPrompt).toContain(
                        "You are Kimi Code, operating as Rig",
                    );
                    expect(request.context.systemPrompt).toContain(
                        "You are now running as a subagent.",
                    );
                    expect(request.context.systemPrompt).toContain(
                        "The parent cannot see your context",
                    );
                    expect(request.context.systemPrompt).toContain(
                        "Your final message is the entire handoff",
                    );
                    childVerified = true;
                    return { content: [{ text: "CHILD_KIMI_OK", type: "text" }] };
                }

                expect(JSON.stringify(request.context.messages)).toContain("CHILD_KIMI_OK");
                parentCompleted = true;
                return { content: [{ text: "PARENT_KIMI_SUBAGENT_OK", type: "text" }] };
            },
            providerId: "kimi",
            providerOverrides: ["kimi"],
            rows: 28,
        });
        running.add(gym);

        gym.terminal.type("Delegate a focused contract check to a child.");
        gym.terminal.press("enter");

        const result = await gym.terminal.waitForText("PARENT_KIMI_SUBAGENT_OK", 30_000);
        expect(result.text).toContain('"Inspect the Kimi child contract" completed in');
        expect(result.text).not.toContain("Tool 'Agent' failed");
        expect(childVerified).toBe(true);
        expect(parentCompleted).toBe(true);
    }, 120_000);
});

function assertKimiToolContracts(tools: readonly Tool[]): void {
    expect(tools.find((tool) => tool.name === "Agent")?.description).toContain(
        "The subagent has its own context",
    );
    expect(tools.find((tool) => tool.name === "Read")?.description).toContain(
        "If the user provides a concrete file path, call Read directly",
    );
    expect(tools.find((tool) => tool.name === "Bash")?.description).toContain(
        "Each call starts in a fresh shell environment",
    );
    expect(tools.find((tool) => tool.name === "SendMessage")?.description).toContain(
        "retained subagent",
    );
    expect(toolArgumentDescription(tools, "Agent", "prompt")).toContain(
        "Complete task brief for the child",
    );
    expect(toolArgumentDescription(tools, "Read", "file_path")).toBe(
        "Absolute path to the file to read.",
    );
    expect(tools.map((tool) => tool.name)).toContain("TodoList");
    expect(tools.map((tool) => tool.name)).toContain("FetchURL");
}

function toolArgumentDescription(
    tools: readonly Tool[],
    toolName: string,
    argumentName: string,
): string | undefined {
    const tool = tools.find((candidate) => candidate.name === toolName);
    const parameters =
        tool !== undefined && "parameters" in tool
            ? (tool.parameters as { properties?: Record<string, { description?: string }> })
            : undefined;
    return parameters?.properties?.[argumentName]?.description;
}
