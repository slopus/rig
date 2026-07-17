import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("User skills in Workspace write", () => {
    it("discovers and invokes skills from both Codex user roots", async () => {
        const gym = await createGym({
            homeFiles: {
                ".agents/skills/agents-home/SKILL.md": skillFile(
                    "agents-home",
                    "AGENTS_HOME_SKILL_BODY",
                ),
                ".codex/skills/codex-home/SKILL.md": skillFile(
                    "codex-home",
                    "CODEX_HOME_SKILL_BODY",
                ),
            },
            inference(request) {
                if (request.options.sessionId?.endsWith(":title")) {
                    return { content: [{ text: "User skills", type: "text" }] };
                }
                const prompt = lastUserText(request.context.messages) ?? "";
                if (prompt.includes("CODEX_HOME_SKILL_BODY")) {
                    return { content: [{ text: "CODEX_USER_SKILL_OK", type: "text" }] };
                }
                if (prompt.includes("AGENTS_HOME_SKILL_BODY")) {
                    return { content: [{ text: "AGENTS_USER_SKILL_OK", type: "text" }] };
                }
                return { body: "User skill invocation was not expanded.", httpStatus: 422 };
            },
            permissionMode: "workspace_write",
        });
        running.add(gym);

        gym.terminal.type("/skill:codex-home inspect codex root");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("CODEX_USER_SKILL_OK", 30_000);

        gym.terminal.type("/skill:agents-home inspect agents root");
        gym.terminal.press("enter");
        const completed = await gym.terminal.waitForText("AGENTS_USER_SKILL_OK", 30_000);

        expect(completed.text).toContain("/skill:codex-home inspect codex root");
        expect(completed.text).toContain("/skill:agents-home inspect agents root");
        expect(completed.text).not.toContain("CODEX_HOME_SKILL_BODY");
        expect(completed.text).not.toContain("AGENTS_HOME_SKILL_BODY");
        expect(agentRequests(gym)).toHaveLength(2);
    }, 120_000);
});

function skillFile(name: string, body: string): string {
    return [
        "---",
        `name: ${name}`,
        `description: Invoke the ${name} user skill.`,
        "---",
        body,
        "",
    ].join("\n");
}

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    );
}

function lastUserText(messages: readonly { role: string; content: unknown }[]): string | undefined {
    const message = [...messages].reverse().find((candidate) => candidate.role === "user");
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return undefined;
    return message.content
        .filter(
            (block): block is { text: string; type: "text" } =>
                typeof block === "object" &&
                block !== null &&
                "type" in block &&
                block.type === "text" &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("");
}
