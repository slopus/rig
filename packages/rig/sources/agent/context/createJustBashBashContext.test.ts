import { Bash } from "just-bash";
import { describe, expect, it } from "vitest";

import { createJustBashBashContext } from "./createJustBashBashContext.js";
import { MAX_ACTIVE_BASH_SESSIONS } from "./bashSessionLimits.js";

describe("createJustBashBashContext", () => {
    it("rejects background work beyond the active session limit", async () => {
        const exec = () => new Promise<never>(() => {});
        const context = createJustBashBashContext({ exec } as unknown as Bash, "/workspace");
        for (let index = 0; index < MAX_ACTIVE_BASH_SESSIONS; index += 1) {
            await context.startSession({ command: `pending-${String(index)}` });
        }

        await expect(context.startSession({ command: "one-too-many" })).rejects.toThrow(
            `No more than ${String(MAX_ACTIVE_BASH_SESSIONS)} background commands can run at once.`,
        );
    });

    it("retains a bounded set of completed background sessions", async () => {
        const context = createJustBashBashContext(new Bash({ cwd: "/workspace" }), "/workspace");

        for (let index = 1; index <= 65; index += 1) {
            const sessionId = await context.startSession({ command: `echo session-${index}` });
            await context.readSession(sessionId, { waitMs: 1_000 });
        }

        await expect(context.readSession(1)).resolves.toBeUndefined();
        await expect(context.readSession(65)).resolves.toMatchObject({
            status: "completed",
            stdout: "session-65\n",
        });
        expect(context.supportsSessionInput).toBe(false);
        await expect(context.writeSession(65, "input")).resolves.toBe(false);
    });
});
