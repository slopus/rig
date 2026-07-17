import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const currentVersion = (
    JSON.parse(
        readFileSync(new URL("../../packages/rig/package.json", import.meta.url), "utf8"),
    ) as { version: string }
).version;

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("starting Rig with a stale production daemon", () => {
    it("asks before replacing a daemon from another installed version", async () => {
        const cliPath = "/tmp/rig-under-test/dist/main.js";
        const packagePath = "/tmp/rig-under-test/package.json";
        const setup = [
            "mkdir -p /tmp/rig-under-test",
            "cp -R /app/packages/rig/dist /tmp/rig-under-test/dist",
            "cp /app/packages/rig/package.json /tmp/rig-under-test/package.json",
            "ln -s /app/packages/rig/node_modules /tmp/rig-under-test/node_modules",
            `node ${cliPath} daemon start`,
            `node --input-type=module -e 'import { readFileSync, writeFileSync } from "node:fs"; const path = "${packagePath}"; const manifest = JSON.parse(readFileSync(path, "utf8")); manifest.version = "999.999.999"; writeFileSync(path, JSON.stringify(manifest, null, 4) + "\\n");'`,
            `exec node ${cliPath}`,
        ].join("\n");
        const gym = await createGym({
            entrypoint: ["/bin/sh", "-lc", setup],
            inference: [],
            startupText: "Restart local daemon?",
            timeoutMs: 10_000,
        });
        running.add(gym);

        const prompt = await gym.terminal.snapshot();
        expect(prompt.text).toContain(`The running daemon uses Rig ${currentVersion}`);
        expect(prompt.text).toContain("this CLI is Rig 999.999.999");
        expect(prompt.text).toContain("Restart daemon");
        expect(prompt.text).toContain("Exit Rig");

        gym.terminal.press("enter");

        const started = await gym.terminal.waitForText("Ask Rig to do anything", 20_000);
        expect(started.text).not.toContain("Restart local daemon?");
    });
});
