import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { captureScrollback, createGym, waitForTerminalOutput, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("transcript growth beyond the historical entry cap", () => {
    it("retains already-rendered history and the exact middle viewport", async () => {
        const gym = await createGym({
            cols: 70,
            inference: (_request, callIndex) => ({
                content: [
                    {
                        text: `CAP_RESPONSE_${String(callIndex).padStart(3, "0")}`,
                        type: "text",
                    },
                ],
            }),
            rows: 16,
        });
        running.add(gym);

        for (let index = 0; index < 240; index += 1) await completeTurn(gym, index);

        gym.terminal.scrollToTop();
        gym.terminal.scrollBy(36);
        const anchored = await gym.terminal.snapshot();
        expect(anchored.scroll.atTop).toBe(false);
        expect(anchored.scroll.atBottom).toBe(false);
        expect(anchored.text).toContain("CAP_RESPONSE_");
        const anchorMarker = /CAP_RESPONSE_\d{3}/u.exec(anchored.text)?.[0];
        expect(anchorMarker).toBeDefined();
        if (anchorMarker === undefined) throw new Error("Cap anchor marker was not visible.");
        const output: string[] = [];
        const stopOutputCapture = gym.terminal.onOutput((data) => output.push(data));
        await screenshot(gym, "entry-cap-01-anchored.png");

        for (let index = 240; index < 270; index += 1) await completeTurn(gym, index, true);

        const afterCap = await gym.terminal.snapshot();
        expect(afterCap.rows).toEqual(anchored.rows);
        expect(afterCap.text).toBe(anchored.text);
        expect(afterCap.scroll.offset).toBe(anchored.scroll.offset);
        expect(afterCap.scroll.bottomDepartureCount).toBe(anchored.scroll.bottomDepartureCount);
        expect(afterCap.scroll.topArrivalCount).toBe(anchored.scroll.topArrivalCount);
        expect(output.join("")).not.toContain("\x1b[3J");
        expect(output.join("")).not.toContain("\x1b[2J\x1b[H");
        stopOutputCapture();
        await screenshot(gym, "entry-cap-02-grown-while-anchored.png");

        gym.terminal.scrollToBottom();
        const bottom = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CAP_RESPONSE_269") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the current transcript tail after crossing the entry cap",
            30_000,
        );
        expect(bottom.scroll.offset + bottom.scroll.visibleRows).toBe(bottom.scroll.totalRows);
        await screenshot(gym, "entry-cap-03-returned-to-bottom.png");

        await completeTurn(gym, 270);
        const revisedBottom = await gym.terminal.snapshot();
        expect(revisedBottom.text).toContain("CAP_RESPONSE_270");
        expect(revisedBottom.scroll.atBottom).toBe(true);

        const scrollback = await captureScrollback(gym);
        expect(countOccurrences(scrollback, anchorMarker)).toBe(1);
        expect(countOccurrences(scrollback, "CAP_RESPONSE_135")).toBe(1);
        expect(countOccurrences(scrollback, "CAP_RESPONSE_270")).toBe(1);
        expect(maximumBlankRun(scrollback)).toBeLessThanOrEqual(4);
    }, 120_000);
});

async function completeTurn(gym: Gym, index: number, offBottom = false): Promise<void> {
    const marker = `CAP_RESPONSE_${String(index).padStart(3, "0")}`;
    const markerOutput = offBottom ? waitForTerminalOutput(gym, marker, 30_000) : undefined;
    gym.terminal.type(`cap prompt ${String(index).padStart(3, "0")}`);
    gym.terminal.press("enter");
    await markerOutput;
    await gym.terminal.waitUntil(
        (snapshot) =>
            agentRequestCount(gym) === index + 1 &&
            (offBottom ||
                (snapshot.text.includes(marker) &&
                    snapshot.text.includes("Ask Rig to do anything") &&
                    !snapshot.text.includes("esc to interrupt"))),
        `completed cap turn ${String(index)}`,
        30_000,
    );
}

function agentRequestCount(gym: Gym): number {
    return gym.inference.requests.filter(
        (request) => request.options.sessionId?.endsWith(":title") !== true,
    ).length;
}

async function screenshot(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}

function countOccurrences(value: string, search: string): number {
    return value.split(search).length - 1;
}

function maximumBlankRun(value: string): number {
    let maximum = 0;
    let current = 0;
    for (const row of value.split("\n")) {
        current = row.trim().length === 0 ? current + 1 : 0;
        maximum = Math.max(maximum, current);
    }
    return maximum;
}
