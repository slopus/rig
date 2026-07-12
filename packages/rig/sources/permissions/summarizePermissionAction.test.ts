import { describe, expect, it } from "vitest";

import { summarizePermissionAction } from "./summarizePermissionAction.js";

describe("summarizePermissionAction", () => {
    it("keeps the complete command visible while normalizing whitespace", () => {
        const command = `printf start
${"x".repeat(140)}
printf VISIBLE_COMMAND_SUFFIX`;

        const action = summarizePermissionAction("exec_command", { cmd: command });

        expect(action).toBe(
            `running “printf start ${"x".repeat(140)} printf VISIBLE_COMMAND_SUFFIX”`,
        );
        expect(action).not.toContain("…");
    });
});
