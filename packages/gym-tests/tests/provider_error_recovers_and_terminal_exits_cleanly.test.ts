import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 80;
const ROWS = 40;
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("provider error recovers and terminal exits cleanly", () => {
    it("recovers, clears a draft with Ctrl+C, and exits an empty composer with Ctrl+D", async () => {
        const gym = await createGym({
            cols: COLS,
            inference: [
                { disconnect: true },
                { content: [{ text: "RECOVERY_TURN_OK", type: "text" }] },
            ],
            rows: ROWS,
        });
        running.add(gym);
        const initialScroll = (await gym.terminal.snapshot()).scroll;
        let exited = false;
        void gym.exit().then(() => {
            exited = true;
        });

        submit(gym, "Trigger a recoverable provider error.");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("RECOVERY_TURN_OK") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "automatic recovery from the transient provider error",
            30_000,
        );
        expect(recovered.text).toContain("RECOVERY_TURN_OK");
        expect(recovered.text).not.toContain("fetch failed");
        assertHealthyInteractiveTerminal(recovered, initialScroll);

        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(agentRequests).toHaveLength(2);
        expect(agentRequests[0]?.context.messages.at(-1)).toMatchObject({
            content: [{ text: "Trigger a recoverable provider error.", type: "text" }],
            role: "user",
        });
        expect(agentRequests[1]?.context.messages.at(-1)).toMatchObject({
            content: [{ text: "Trigger a recoverable provider error.", type: "text" }],
            role: "user",
        });

        gym.terminal.type("UNSENT_DRAFT_MUST_CLEAR");
        await gym.terminal.waitForText("UNSENT_DRAFT_MUST_CLEAR");
        gym.terminal.press("ctrlC");
        const cleared = await gym.terminal.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("UNSENT_DRAFT_MUST_CLEAR") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "Ctrl+C to clear the draft and restore the empty composer",
        );
        expect(exited).toBe(false);
        expect(gym.inference.requests.filter(isAgentRequest)).toHaveLength(2);
        assertHealthyInteractiveTerminal(cleared, initialScroll);

        gym.terminal.press("ctrlD");
        const exit = await gym.exit();
        expect(exit.exitCode).toBe(0);
        expect(exit.signal ?? 0).toBe(0);

        const final = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Session:") && snapshot.text.includes("Resume: rig resume "),
            "session and resume handoff after exit",
        );
        expect(final.rows).toHaveLength(ROWS);
        expect(final.rows.every((row) => [...row].length <= COLS)).toBe(true);
        expect(final.scroll.atBottom).toBe(true);
        expect(final.scroll.bottomDepartureCount).toBe(initialScroll.bottomDepartureCount);
        expect(final.scroll.topArrivalCount).toBe(initialScroll.topArrivalCount);
        expect(final.cursor.visible).toBe(true);
        expect(final.cursor.x).toBeLessThan(COLS);
        expect(final.cursor.y).toBeLessThan(ROWS);
        expect(final.title).toContain("Rig");
        expect(final.text).not.toContain("fetch failed");
        expect(final.text).toContain("RECOVERY_TURN_OK");
        expect(final.text).not.toContain("UNSENT_DRAFT_MUST_CLEAR");
        expect(gym.inference.requests.filter(isAgentRequest)).toHaveLength(2);
        assertControlHygiene(final);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function isAgentRequest(request: Gym["inference"]["requests"][number]): boolean {
    return !request.options.sessionId?.endsWith(":title");
}

function assertHealthyInteractiveTerminal(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    initialScroll: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(ROWS);
    expect(snapshot.rows.every((row) => [...row].length <= COLS)).toBe(true);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(initialScroll.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(initialScroll.topArrivalCount);
    expect(snapshot.cursor.visible).toBe(false);
    expect(snapshot.cursor.x).toBeLessThan(COLS);
    expect(snapshot.cursor.y).toBeLessThan(ROWS);
    expect(snapshot.title).toContain("Rig");
    expect(snapshot.text).toContain("Ask Rig to do anything");
    expect(snapshot.text).toContain("gym off · /workspace");
    expect(snapshot.text).not.toContain("ECONNRESET");
    assertControlHygiene(snapshot);
}

function assertControlHygiene(snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>): void {
    for (const control of ["\u0000", "\u0007", "\u001b", "�"]) {
        expect(snapshot.text).not.toContain(control);
    }
    expect(snapshot.text).not.toContain("\x1b[200~");
    expect(snapshot.text).not.toContain("\x1b[201~");
}
