import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Escape during queued turn startup", () => {
    it("keeps the prompt recoverable until the next turn reaches inference", async () => {
        const finishFirstTurn = deferred<void>();
        const firstTurnContinuationStarted = deferred<void>();
        const createBlockingSkill = [
            "node -e '",
            'const fs=require("fs"); for(let i=0;i<2000;i++){',
            'const dir="/home/rig/.agents/skills/gate-"+i;',
            "fs.mkdirSync(dir,{recursive:true});",
            'fs.writeFileSync(dir+"/SKILL.md","---\\nname: gate-"+i+"\\ndescription: Gym gate\\n---\\ngate\\n");',
            "}'",
        ].join(" ");
        const gym = await createGym({
            cols: 76,
            inference: async (request, callIndex) => {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: createBlockingSkill },
                                id: "create-blocking-skill-refresh",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    expect(request.context.messages.at(-1)).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    firstTurnContinuationStarted.resolve();
                    await finishFirstTurn.promise;
                    return { content: [{ text: "FIRST_TURN_COMPLETE", type: "text" }] };
                }
                expect(callIndex).toBe(2);
                expect(lastUserText(request.context.messages)).toBe("queued turn must survive");
                return { content: [{ text: "QUEUED_TURN_RECOVERED", type: "text" }] };
            },
            rows: 22,
        });
        running.add(gym);

        submit(gym, "Prepare the queued-turn startup gate.");
        await firstTurnContinuationStarted.promise;

        gym.terminal.type("queued turn must survive");
        await gym.terminal.waitForText("› queued turn must survive", 30_000);
        gym.terminal.press("tab");
        await gym.terminal.waitForText("↳ queued queued turn must survive", 30_000);

        finishFirstTurn.resolve();
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("FIRST_TURN_COMPLETE") &&
                snapshot.text.includes("esc to interrupt"),
            "the queued turn entering its interruptible startup",
            30_000,
        );

        gym.terminal.press("escape");
        const restored = await gym.terminal.waitUntil(
            (snapshot) => {
                const interruptionIndex = snapshot.text.indexOf("Session interrupted");
                const promptIndex = snapshot.text.lastIndexOf("› queued turn must survive");
                return interruptionIndex >= 0 && promptIndex > interruptionIndex;
            },
            "Escape restoring the queued prompt during turn startup",
            30_000,
        );
        expect(restored.text).not.toContain("↳ queued");
        expect(agentRequests(gym)).toHaveLength(2);

        gym.terminal.press("enter");
        await gym.terminal.waitForText("QUEUED_TURN_RECOVERED", 30_000);
        expect(agentRequests(gym)).toHaveLength(3);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
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

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: (value) => resolvePromise(value as T),
    };
}
