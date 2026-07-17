import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("secrets manager", () => {
    it("registers, attaches, uses, detaches, and removes a masked bundle", async () => {
        const token = "ui-secret-value-never-render";
        const host = "ui-host-value-never-render";
        const gym = await createGym({
            cols: 100,
            rows: 36,
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: 'printf "%s|%s" "$UI_SECRET_TOKEN" "$UI_SECRET_HOST" > ui-secret-result.txt',
                                secrets: ["ui-service"],
                            },
                            id: "use-ui-secret",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "UI secret verified.", type: "text" }] },
            ],
        });
        running.add(gym);

        gym.terminal.type("/secrets");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Add secret");
        gym.terminal.press("enter");

        await gym.terminal.waitForText("ID:");
        gym.terminal.type("ui-service");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Description:");
        gym.terminal.type("UI service credentials");
        gym.terminal.press("enter");

        await gym.terminal.waitForText("Name:");
        gym.terminal.type("UI_SECRET_TOKEN");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Value:");
        gym.terminal.type(token);
        const maskedToken = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("*".repeat(token.length)),
            "the first secret value to render as mask characters",
        );
        expect(maskedToken.text).not.toContain(token);
        gym.terminal.press("enter");

        await gym.terminal.waitForText("Add another variable");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Name:");
        gym.terminal.type("UI_SECRET_HOST");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Value:");
        gym.terminal.type(host);
        const maskedHost = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("*".repeat(host.length)),
            "the second secret value to render as mask characters",
        );
        expect(maskedHost.text).not.toContain(host);
        gym.terminal.press("enter");

        await gym.terminal.waitForText("Register secret");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("UI service credentials");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Make this bundle available");
        gym.terminal.press("enter");
        const scope = await gym.terminal.waitForText("Choose where this attachment applies");
        expect(scope.text).toMatch(/→\s+Session/u);
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Attached: Session");
        gym.terminal.press("escape");
        await gym.terminal.waitForText("Ask Rig to do anything");

        gym.terminal.type("Use the attached UI service credentials.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("UI secret verified.", 30_000);
        await expect(gym.readFile("ui-secret-result.txt")).resolves.toBe(`${token}|${host}`);
        expect(JSON.stringify(gym.inference.requests)).not.toContain(token);
        expect(JSON.stringify(gym.inference.requests)).not.toContain(host);

        gym.terminal.type("/secrets");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Attached: Session");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Stop making this bundle available");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Choose where this attachment applies");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Not attached");

        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Delete this bundle from Rig");
        gym.terminal.press("down");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Remove registration");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Removed secret registration 'ui-service'.");

        const visibleAndScrollback = (await collectScrollbackRows(gym)).join("\n");
        expect(visibleAndScrollback).not.toContain(token);
        expect(visibleAndScrollback).not.toContain(host);
    }, 120_000);
});

async function collectScrollbackRows(gym: Gym): Promise<readonly string[]> {
    gym.terminal.scrollToTop();
    let snapshot = await gym.terminal.snapshot();
    const rows = new Map<number, string>();

    for (;;) {
        snapshot.rows.forEach((row, index) => {
            rows.set(snapshot.scroll.offset + index, row);
        });
        if (snapshot.scroll.atBottom) break;
        const maximumOffset = snapshot.scroll.totalRows - snapshot.scroll.visibleRows;
        const nextOffset = Math.min(
            snapshot.scroll.offset + snapshot.scroll.visibleRows,
            maximumOffset,
        );
        gym.terminal.scrollBy(nextOffset - snapshot.scroll.offset);
        snapshot = await gym.terminal.snapshot();
    }

    gym.terminal.scrollToBottom();
    return [...rows.entries()].sort(([left], [right]) => left - right).map(([, row]) => row);
}
