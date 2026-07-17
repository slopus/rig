import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("project skill expands instructions but keeps a readable command", () => {
    it("discovers a project skill, sends its body and arguments, and handles a missing skill", async () => {
        const gym = await createGym({
            files: {
                ".agents/skills/fixture-check/SKILL.md": [
                    "---",
                    "name: fixture-check",
                    "description: Check a fixture with the repository workflow.",
                    "---",
                    "SKILL_BODY_SENTINEL",
                    "Follow the fixture-specific checklist.",
                    "",
                ].join("\n"),
            },
            inference(request) {
                const prompt = lastUserText(request.context.messages) ?? "";
                if (!prompt.includes("SKILL_BODY_SENTINEL") || !prompt.includes("inspect target")) {
                    return { body: "Skill invocation was not expanded.", httpStatus: 422 };
                }
                return { content: [{ text: "SKILL_INVOCATION_ACCEPTED", type: "text" }] };
            },
            rows: 22,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("/skill:fixture-check inspect target");
        gym.terminal.press("enter");
        const completed = await gym.terminal.waitForText("SKILL_INVOCATION_ACCEPTED", 30_000);
        expect(completed.text).toContain("/skill:fixture-check inspect target");
        expect(completed.text).not.toContain("SKILL_BODY_SENTINEL");

        gym.terminal.type("/skill:not-installed");
        gym.terminal.press("enter");
        const missing = await gym.terminal.waitForText("Skill 'not-installed' was not found.");
        expect(missing.rows).toHaveLength(22);
        expect(missing.text).toContain("Ask Rig to do anything");
        expect(missing.scroll.atBottom).toBe(true);
        expect(missing.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(missing.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(agentRequests(gym)).toHaveLength(1);
    });
});

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
