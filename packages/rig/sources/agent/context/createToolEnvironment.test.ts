import { describe, expect, it } from "vitest";

import { createToolEnvironment } from "./createToolEnvironment.js";

describe("createToolEnvironment", () => {
    it("removes attacker-controlled executable search paths in restricted modes", () => {
        const environment = {
            HOME: "/home/user",
            PATH: "/workspace/node_modules/.bin:/home/user/bin:/tmp/attacker:/usr/bin",
        };

        expect(createToolEnvironment("workspace_write", environment).PATH).toBe(
            process.platform === "win32"
                ? environment.PATH
                : "/opt/homebrew/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        );
        expect(createToolEnvironment("full_access", environment).PATH).toBe(environment.PATH);
    });
});
