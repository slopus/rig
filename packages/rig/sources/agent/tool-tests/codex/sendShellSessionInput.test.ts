import { describe, expect, it } from "vitest";

import type { BashContext } from "../../context/BashContext.js";
import { sendShellSessionInput } from "../../tools/codex/impl/sendShellSessionInput.js";

describe("sendShellSessionInput", () => {
    it("preserves input surrounding an interrupt in its original order", async () => {
        const events: string[] = [];
        const bash = recordingBashContext(events);

        await sendShellSessionInput(bash, 7, "before\u0003after");

        expect(events).toEqual(["write:before", "interrupt:7", "write:after"]);
    });

    it("rejects interrupts when the backend does not support them", async () => {
        const bash = recordingBashContext([], false);

        await expect(sendShellSessionInput(bash, 7, "\u0003")).rejects.toThrow(
            "does not support interrupts",
        );
    });
});

function recordingBashContext(events: string[], supportsInterrupts = true): BashContext {
    return {
        cwd: "/workspace",
        ...(supportsInterrupts
            ? {
                  async interruptSession(sessionId: number) {
                      events.push(`interrupt:${sessionId}`);
                      return true;
                  },
              }
            : {}),
        async killSession() {
            return undefined;
        },
        async readSession() {
            return undefined;
        },
        async run() {
            return { exitCode: 0, stderr: "", stdout: "", timedOut: false };
        },
        async startSession() {
            return 1;
        },
        supportsSessionInput: true,
        async writeSession(_sessionId, data) {
            events.push(`write:${String(data)}`);
            return true;
        },
    };
}
