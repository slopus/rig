import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("permissions menu enforces Read only then Full access", () => {
    it("blocks a real workspace write before allowing the same file to change", async () => {
        const readOnlyPatch = [
            "*** Begin Patch",
            "*** Update File: protected.txt",
            "@@",
            "-original value",
            "+changed while read only",
            "*** End Patch",
        ].join("\n");
        const fullAccessPatch = [
            "*** Begin Patch",
            "*** Update File: protected.txt",
            "@@",
            "-original value",
            "+changed with full access",
            "*** End Patch",
        ].join("\n");
        const blockedResult =
            "Tool 'apply_patch' failed: File changes are disabled in read-only mode.";
        const successfulResult = "Success. Updated the following files:\nM protected.txt";
        const gym = await createGym({
            cols: 94,
            files: { "protected.txt": "original value\n" },
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
                    expect(lastMessage).toMatchObject({ role: "user" });
                    expect(resultText).toContain("Try to change the protected file now.");
                    return {
                        content: [
                            {
                                arguments: { patch: readOnlyPatch, workdir: "/workspace" },
                                id: "read-only-write-attempt",
                                name: "apply_patch",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        content: [{ text: blockedResult, type: "text" }],
                        isError: true,
                        role: "toolResult",
                        toolName: "apply_patch",
                    });
                    expect(resultText).toBe(blockedResult);
                    return {
                        content: [{ text: "READ_ONLY_WRITE_BLOCKED", type: "text" }],
                        delayMs: 1_000,
                    };
                }

                if (callIndex === 2) {
                    expect(lastMessage).toMatchObject({ role: "user" });
                    expect(resultText).toContain("Change the protected file with full access.");
                    return {
                        content: [
                            {
                                arguments: { patch: fullAccessPatch, workdir: "/workspace" },
                                id: "full-access-write-attempt",
                                name: "apply_patch",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 3) {
                    expect(lastMessage).toMatchObject({
                        content: [{ text: successfulResult, type: "text" }],
                        isError: false,
                        role: "toolResult",
                        toolName: "apply_patch",
                    });
                    expect(resultText).toBe(successfulResult);
                    return {
                        content: [{ text: "FULL_ACCESS_WRITE_SUCCEEDED", type: "text" }],
                        delayMs: 1_000,
                    };
                }

                expect(callIndex).toBe(4);
                expect(lastMessage).toMatchObject({ role: "user" });
                expect(resultText).toContain("Confirm recovery after both permission modes.");
                return {
                    content: [{ text: "PERMISSION_RECOVERY_ACCEPTED", type: "text" }],
                };
            },
            rows: 26,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("/permissions");
        gym.terminal.press("enter");
        const initialMenu = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("Choose Permissions") && snapshot.scroll.atBottom,
            "permissions menu",
        );
        expect(initialMenu.rows).toHaveLength(26);
        expect(initialMenu.text).toContain("Applies to this session and its subagents");
        expect(initialMenu.text).toContain("Auto");
        expect(initialMenu.text).toContain("Workspace write");
        expect(initialMenu.text).toContain("Read only");
        expect(initialMenu.text).toContain("Full access");
        expect(initialMenu.text).not.toContain("read_only");
        expect(initialMenu.text).not.toContain("full_access");
        expect(initialMenu.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(initialMenu.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.press("up");
        gym.terminal.press("enter");
        const readOnlySelected = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Permissions changed to Read only.") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "Read only permission selection",
        );
        expect(readOnlySelected.text).not.toContain("read_only");
        expect(readOnlySelected.text).toContain("gym off · /workspace");
        expect(readOnlySelected.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(readOnlySelected.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.type("Try to change the protected file now.");
        gym.terminal.press("enter");
        const blocked = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("File changes are disabled in read-only mode.") &&
                snapshot.scroll.atBottom,
            "readable read-only write error",
            30_000,
        );
        expect(blocked.text).toContain("Failed");
        expect(blocked.text).toContain("File changes are disabled in read-only mode.");
        expect(blocked.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(blocked.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        await expect(gym.readFile("protected.txt")).resolves.toBe("original value\n");

        const readOnlyComplete = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("READ_ONLY_WRITE_BLOCKED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "read-only result and recovered composer",
            30_000,
        );
        expect(readOnlyComplete.text).toContain("gym off · /workspace");

        gym.terminal.type("/permissions");
        gym.terminal.press("enter");
        const secondMenu = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("Choose Permissions") && snapshot.scroll.atBottom,
            "permissions menu with Read only selected",
        );
        expect(secondMenu.text).toContain("→ Read only");
        expect(secondMenu.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(secondMenu.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.press("down");
        gym.terminal.press("enter");
        const fullAccessSelected = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Permissions changed to Full access.") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "Full access permission selection",
        );
        expect(fullAccessSelected.text).not.toContain("full_access");
        expect(fullAccessSelected.text).toContain("gym off · /workspace");
        expect(fullAccessSelected.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(fullAccessSelected.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.type("Change the protected file with full access.");
        gym.terminal.press("enter");
        const applied = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("• Edited protected.txt (+1 -1)") &&
                snapshot.scroll.atBottom,
            "successful Full access write",
            30_000,
        );
        expect(applied.text).toContain("    1 -original value");
        expect(applied.text).toContain("    1 +changed with full access");
        expect(applied.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(applied.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        await expect(gym.readFile("protected.txt")).resolves.toBe("changed with full access\n");

        const fullAccessComplete = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("FULL_ACCESS_WRITE_SUCCEEDED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "Full access result and idle composer",
            30_000,
        );
        expect(fullAccessComplete.rows).toHaveLength(26);
        expect(fullAccessComplete.scroll.visibleRows).toBe(26);
        expect(fullAccessComplete.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(fullAccessComplete.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(fullAccessComplete.text).toContain("gym off · /workspace");
        expect(fullAccessComplete.text).not.toContain("�");
        expect(fullAccessComplete.cursor.x).toBeLessThan(94);
        expect(fullAccessComplete.cursor.y).toBeLessThan(26);

        gym.terminal.type("Confirm recovery after both permission modes.");
        gym.terminal.press("enter");
        const recovery = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PERMISSION_RECOVERY_ACCEPTED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up after both permission modes",
            30_000,
        );
        expect(recovery.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(recovery.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(recovery.text).toContain("gym off · /workspace");
        expect(recovery.text).not.toContain("�");
    }, 120_000);
});
