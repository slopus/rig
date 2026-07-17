import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";

import {
    createGym,
    renderTerminalSnapshotPng,
    terminalRowStyleRuns,
    type Gym,
    type TerminalSnapshot,
} from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("background shell activity stays visible until it really finishes", () => {
    it("matches the Codex summary above the composer and supports /ps and /stop", async () => {
        const command =
            "printf 'BACKGROUND_PROCESS_STARTED\\n'; sleep 60; printf 'finished\\n' > background-process-state.txt";
        const gym = await createGym({
            cols: 88,
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: command, yield_time_ms: 250 },
                                id: "start-background-process",
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
                    expect(toolResultText(lastMessage?.content)).toMatch(
                        /Process running with session ID \d+/u,
                    );
                    return {
                        content: [
                            {
                                text: "The command is still running, and Rig is showing that activity.",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(lastMessage).toMatchObject({ role: "user" });
                return {
                    content: [{ text: "The terminal is ready for more work.", type: "text" }],
                };
            },
            rows: 24,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Start the command and tell me if anything is still running.");
        gym.terminal.press("enter");

        const active = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("The command is still running") &&
                snapshot.text.includes(
                    "1 background terminal running · /ps to view · /stop to close",
                ) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.scroll.atBottom,
            "an idle composer that still discloses the background process",
            30_000,
        );
        const summaryRow = active.rows.findIndex((row) =>
            row.includes("1 background terminal running"),
        );
        const composerRow = active.rows.findIndex((row) => row.includes("Ask Rig to do anything"));
        const footerRow = active.rows.findIndex((row) => row.includes("gym off · /workspace"));
        expect(summaryRow).toBeGreaterThanOrEqual(0);
        expect(summaryRow).toBeLessThan(composerRow);
        expect(composerRow).toBeLessThan(footerRow);
        expect(active.text).toContain("• Ran printf");
        expect(active.text).toContain("The command is still running");
        expect(active.text).not.toMatch(/session ID/iu);
        expect(active.text).not.toContain("• Running printf");
        expect(active.text).not.toContain("Process printf 'BACKGROUND_PROCESS_STARTED");
        expect(active.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(active.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(active.rows.slice(summaryRow, footerRow + 1)).toEqual([
            "  1 background terminal running · /ps to view · /stop to close",
            "",
            "",
            "› Ask Rig to do anything",
            "",
            "  gym off · /workspace · full access",
        ]);
        expect(terminalRowStyleRuns(active, summaryRow)).toEqual([
            {
                background: null,
                bold: false,
                dim: true,
                foreground: null,
                italic: false,
                text: "1 background terminal running · /ps to view · /stop to close",
                x: 2,
            },
        ]);
        await captureReviewImage(active, "background-terminal-active.png");

        gym.terminal.type("/ps");
        gym.terminal.press("enter");
        const listed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Background terminals") &&
                snapshot.text.includes("printf 'BACKGROUND_PROCESS_STARTED") &&
                snapshot.text.includes("1 background terminal running") &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.scroll.atBottom,
            "/ps to list the running background terminal",
            30_000,
        );
        expect(listed.text).not.toMatch(/session ID/iu);

        gym.terminal.type("/stop");
        gym.terminal.press("enter");
        const stopped = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Stopping all background terminals.") &&
                !snapshot.text.includes("1 background terminal running") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.scroll.atBottom,
            "/stop to close the running background terminal",
            30_000,
        );
        await expect(gym.readFile("background-process-state.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(stopped.text).not.toMatch(/session ID/iu);
        expect(stopped.rows).toHaveLength(24);
        expect(stopped.text).toContain("gym off · /workspace");
        expect(stopped.text).not.toContain("�");
        expect(stopped.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(stopped.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        await captureReviewImage(stopped, "background-terminal-stopped.png");

        gym.terminal.type("Confirm you are ready for the next request.");
        gym.terminal.press("enter");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("The terminal is ready for more work.") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.scroll.atBottom,
            "a healthy turn after the background process completed",
            30_000,
        );
        expect(recovered.text).not.toContain("Process printf 'BACKGROUND_PROCESS_STARTED");
        expect(recovered.text).not.toContain("background terminal running");
        expect(recovered.text).not.toMatch(/session ID/iu);
        expect(recovered.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(recovered.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    }, 120_000);
});

async function captureReviewImage(snapshot: TerminalSnapshot, fileName: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await renderTerminalSnapshotPng(snapshot, resolve(directory, fileName));
}

function toolResultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
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
