import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("reducing permissions stops existing Full access processes", () => {
    it("does not let an old privileged process mutate the workspace under a Read only footer", async () => {
        const command =
            "printf 'PRIVILEGED_PROCESS_STARTED\\n'; sleep 6; printf 'late privileged write\\n' > privileged-after-downgrade.txt";
        const gym = await createGym({
            cols: 96,
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: command, yield_time_ms: 250 },
                                id: "privileged-background-command",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return {
                        content: [{ text: "FULL_ACCESS_PROCESS_IS_RUNNING", type: "text" }],
                    };
                }
                expect(callIndex).toBe(2);
                return { content: [{ text: "DOWNGRADE_FOLLOW_UP_OK", type: "text" }] };
            },
            rows: 26,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Start the delayed local task.");
        const active = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("FULL_ACCESS_PROCESS_IS_RUNNING") &&
                snapshot.text.includes("1 background terminal running") &&
                snapshot.text.includes("full access") &&
                snapshot.scroll.atBottom,
            "the Full access process running in the background",
            30_000,
        );
        expect(active.text).not.toContain("privileged-background-command");
        assertHealthy(active, baseline);

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("enter");

        const reduced = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Permissions changed to Read only.") &&
                !snapshot.text.includes("background terminal running") &&
                snapshot.text.includes("read only") &&
                snapshot.scroll.atBottom,
            "the privilege downgrade stopping prior processes",
            30_000,
        );
        expect(reduced.text).toContain("Stopped 1 running process before reducing permissions.");
        await expect(gym.readFile("privileged-after-downgrade.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        assertHealthy(reduced, baseline);

        submit(gym, "Confirm the downgraded session still works.");
        const followUp = await gym.terminal.waitForText("DOWNGRADE_FOLLOW_UP_OK", 30_000);
        await expect(gym.readFile("privileged-after-downgrade.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(followUp.text).toContain("read only");
        assertHealthy(followUp, baseline);
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
    expect(snapshot.rows).toHaveLength(26);
    expect(snapshot.scroll.visibleRows).toBe(26);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(96);
    expect(snapshot.cursor.y).toBeLessThan(26);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
}
