import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 100;
const ROWS = 28;
const EVIDENCE = "profile-bypass-evidence.txt";
const PROFILE_PAYLOAD = `printf 'host profile ran before sandbox\\n' > /workspace/${EVIDENCE}`;
const PROFILE_BASE64 = Buffer.from(`${PROFILE_PAYLOAD}\n`).toString("base64");
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("restricted shell wrappers do not run host profiles", () => {
    it("does not execute persistence planted by an earlier Full access command", async () => {
        let stage = 0;
        const gym = await createGym({
            cols: COLS,
            inference(request) {
                if (request.options.sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Shell profile audit", type: "text" }] };
                }
                const lastMessage = request.context.messages.at(-1);
                if (stage === 0) {
                    stage = 1;
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: `printf '%s' '${PROFILE_BASE64}' | base64 -d > /home/rig/.profile`,
                                },
                                id: "plant-host-profile",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (stage === 1) {
                    stage = 2;
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return { content: [{ text: "HOST_PROFILE_FIXTURE_READY", type: "text" }] };
                }
                if (stage === 2) {
                    stage = 3;
                    return {
                        content: [
                            {
                                arguments: { cmd: "printf 'RESTRICTED_COMMAND_RAN\\n'" },
                                id: "restricted-command-after-profile",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(stage).toBe(3);
                expect(lastMessage).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "exec_command",
                });
                return { content: [{ text: "HOST_PROFILE_BYPASS_BLOCKED", type: "text" }] };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Create the synthetic host-profile persistence fixture.");
        await gym.terminal.waitForText("HOST_PROFILE_FIXTURE_READY", 30_000);

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Workspace write.");

        submit(gym, "Run only the harmless restricted status command.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("HOST_PROFILE_BYPASS_BLOCKED") &&
                snapshot.text.includes("RESTRICTED_COMMAND_RAN") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the restricted command completing without running the host profile",
            30_000,
        );
        await expect(gym.readFile(EVIDENCE)).rejects.toMatchObject({ code: "ENOENT" });
        expect(outcome.text).not.toContain("host profile ran before sandbox");
        assertHealthy(outcome, baseline);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function assertHealthy(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(ROWS);
    expect(snapshot.scroll.visibleRows).toBe(ROWS);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(COLS);
    expect(snapshot.cursor.y).toBeLessThan(ROWS);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).toContain("workspace write");
    expect(snapshot.text).not.toContain("�");
}
