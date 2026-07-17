import { stat } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";
import type { TerminalCellSnapshot, TerminalSnapshot } from "@slopus/rig-gym/types";

const running = new Set<Gym>();
const REPLAY_MARKER = "DIFF_REPLAY_MARKER";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("apply_patch success and failed hunk are reported", () => {
    it("preserves exact tool-result flow, filesystem state, and terminal usability", async () => {
        const successfulPatch = [
            "*** Begin Patch",
            "*** Update File: src/greet.ts",
            "@@",
            " export function greet(name: string) {",
            "-  return `goodbye, ${name}`;",
            "+  return `hello, ${name}`;",
            " }",
            "*** End Patch",
        ].join("\n");
        const failedPatch = [
            "*** Begin Patch",
            "*** Update File: seed.txt",
            "@@",
            "-this context is not present",
            "+this change must not be written",
            "*** End Patch",
        ].join("\n");
        const successfulResult = "Success. Updated the following files:\nM src/greet.ts";
        const failedResult =
            "Tool 'apply_patch' failed: Invalid patch: hunk did not match seed.txt";
        const gym = await createGym({
            cols: 92,
            entrypoint: [
                "bash",
                "-lc",
                `node /app/packages/rig/dist/main.js; echo ${REPLAY_MARKER}; exec node /app/packages/rig/dist/main.js resume --last`,
            ],
            files: {
                "seed.txt": "original seed\n",
                "src/greet.ts": {
                    content: [
                        "export function greet(name: string) {",
                        "  return `goodbye, ${name}`;",
                        "}",
                    ].join("\n"),
                    mode: 0o755,
                },
            },
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                const resultText =
                    typeof lastMessage?.content === "string"
                        ? lastMessage.content
                        : (lastMessage?.content ?? [])
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join("");

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { patch: successfulPatch, workdir: "/workspace" },
                                id: "apply-successful-patch",
                                name: "apply_patch",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        content: [{ text: successfulResult, type: "text" }],
                        isError: false,
                        role: "toolResult",
                        toolName: "apply_patch",
                    });
                    expect(resultText).toBe(successfulResult);
                    return {
                        content: [
                            {
                                arguments: { patch: failedPatch, workdir: "/workspace" },
                                id: "apply-failed-patch",
                                name: "apply_patch",
                                type: "toolCall",
                            },
                        ],
                        delayMs: 1_000,
                    };
                }

                if (callIndex === 2) {
                    expect(lastMessage).toMatchObject({
                        content: [{ text: failedResult, type: "text" }],
                        isError: true,
                        role: "toolResult",
                        toolName: "apply_patch",
                    });
                    expect(resultText).toBe(failedResult);
                    return {
                        content: [{ text: "PATCH_FLOW_COMPLETE", type: "text" }],
                        delayMs: 1_000,
                    };
                }

                expect(callIndex).toBe(3);
                expect(lastMessage).toMatchObject({ role: "user" });
                expect(resultText).toContain("Verify another turn after both patch results.");
                return {
                    content: [{ text: "PATCH_FOLLOW_UP_ACCEPTED", type: "text" }],
                };
            },
            rows: 40,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Apply one valid patch, then demonstrate a failed patch safely.");
        gym.terminal.press("enter");

        const applied = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Edited src/greet.ts") &&
                snapshot.text.includes("    2 +  return `hello, ${name}`;") &&
                snapshot.scroll.atBottom,
            "human-readable successful patch result",
            30_000,
        );
        expect(applied.text).toContain("• Edited src/greet.ts (+1 -1)");
        expect(applied.text).toContain("    1  export function greet(name: string) {");
        expect(applied.text).toContain("    2 -  return `goodbye, ${name}`;");
        expect(applied.text).toContain("    2 +  return `hello, ${name}`;");
        expect(applied.text).toContain("    3  }");
        expect(stylesForText(applied, "goodbye")).toEqual([
            expect.objectContaining({ background: { kind: "palette", index: 52 } }),
        ]);
        expect(stylesForText(applied, "hello")).toEqual([
            expect.objectContaining({ background: { kind: "palette", index: 22 } }),
        ]);
        expect(stylesForText(applied, "export")).toContainEqual(
            expect.objectContaining({
                foreground: { kind: "rgb", red: 148, green: 226, blue: 213 },
            }),
        );
        expect(stylesForText(applied, "greet(name")).toContainEqual(
            expect.objectContaining({
                foreground: { kind: "rgb", red: 137, green: 180, blue: 250 },
            }),
        );
        expect(applied.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(applied.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        await expect(gym.readFile("src/greet.ts")).resolves.toBe(
            ["export function greet(name: string) {", "  return `hello, ${name}`;", "}"].join("\n"),
        );
        expect((await stat(join(gym.workspacePath, "src/greet.ts"))).mode & 0o777).toBe(0o755);

        const rejected = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Invalid patch: hunk did not match seed.txt") &&
                snapshot.scroll.atBottom,
            "human-readable failed patch result",
            30_000,
        );
        expect(rejected.text).toContain("hunk did not match seed.txt");
        expect(rejected.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(rejected.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        await expect(gym.readFile("seed.txt")).resolves.toBe("original seed\n");
        await expect(gym.readFile("src/greet.ts")).resolves.toBe(
            ["export function greet(name: string) {", "  return `hello, ${name}`;", "}"].join("\n"),
        );

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PATCH_FLOW_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "patch flow completion and idle composer",
            30_000,
        );
        expect(completed.rows).toHaveLength(40);
        expect(completed.scroll.visibleRows).toBe(40);
        expect(completed.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(completed.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(completed.text).toContain("gym off · /workspace");
        expect(completed.text).not.toContain("�");
        expect(completed.cursor.x).toBeLessThan(92);
        expect(completed.cursor.y).toBeLessThan(40);

        gym.terminal.press("ctrlD");
        const replayed = await gym.terminal.waitUntil(
            (snapshot) => {
                const marker = snapshot.text.indexOf(REPLAY_MARKER);
                if (marker < 0) return false;
                const resumed = snapshot.text.slice(marker);
                return (
                    resumed.includes("• Edited src/greet.ts (+1 -1)") &&
                    resumed.includes("    2 -  return `goodbye, ${name}`;") &&
                    resumed.includes("    2 +  return `hello, ${name}`;") &&
                    resumed.includes("Ask Rig to do anything") &&
                    snapshot.scroll.atBottom
                );
            },
            "persisted syntax-highlighted diff after rig resume --last",
            30_000,
        );
        expect(replayed.text.slice(replayed.text.indexOf(REPLAY_MARKER))).not.toContain(
            "Edited Apply patch",
        );

        gym.terminal.type("Verify another turn after both patch results.");
        gym.terminal.press("enter");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PATCH_FOLLOW_UP_ACCEPTED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up turn after successful and failed patches",
            30_000,
        );
        expect(followUp.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(followUp.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(followUp.text).toContain("gym off · /workspace");
        expect(followUp.text).not.toContain("�");

        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(agentRequests).toHaveLength(4);
        expect(agentRequests[1]?.context.messages.at(-1)).toMatchObject({
            content: [{ text: successfulResult, type: "text" }],
            isError: false,
            role: "toolResult",
            toolName: "apply_patch",
        });
        expect(agentRequests[2]?.context.messages.at(-1)).toMatchObject({
            content: [{ text: failedResult, type: "text" }],
            isError: true,
            role: "toolResult",
            toolName: "apply_patch",
        });
        expect(applied.text).toContain("Edited src/greet.ts");
        expect(rejected.text).toContain("Failed Apply patch");
    }, 120_000);
});

function stylesForText(snapshot: TerminalSnapshot, text: string): TerminalCellSnapshot[] {
    const row = snapshot.rows.findIndex((line) => line.includes(text));
    if (row < 0) throw new Error(`Could not find ${JSON.stringify(text)} in terminal cells.`);
    const start = snapshot.rows[row]?.indexOf(text) ?? -1;
    const cells = snapshot.cells.filter(
        (cell) => cell.y === row && cell.x >= start && cell.x < start + text.length,
    );
    return cells.filter(
        (cell, index) =>
            index === 0 ||
            JSON.stringify({
                background: cell.background,
                foreground: cell.foreground,
            }) !==
                JSON.stringify({
                    background: cells[index - 1]?.background,
                    foreground: cells[index - 1]?.foreground,
                }),
    );
}
