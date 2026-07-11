import { Bash } from "just-bash";
import { describe, expect, it } from "vitest";

import { createJustBashBashContext } from "./createJustBashBashContext.js";

describe("createJustBashBashContext", () => {
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
