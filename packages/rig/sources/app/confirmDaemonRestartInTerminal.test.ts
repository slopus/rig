import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { confirmDaemonRestartInTerminal } from "./confirmDaemonRestartInTerminal.js";

describe("confirmDaemonRestartInTerminal", () => {
    it("accepts the default restart choice in an interactive terminal", async () => {
        const input = Object.assign(Readable.from(["\n"]), { isTTY: true });
        let output = "";
        const restart = await confirmDaemonRestartInTerminal(
            {
                currentIdentity: { version: "1.3.0" },
                runningIdentity: { version: "1.2.0" },
            },
            {
                input,
                output: new Writable({
                    write(chunk, _encoding, callback) {
                        output += String(chunk);
                        callback();
                    },
                }),
            },
        );

        expect(restart).toBe(true);
        expect(output).toContain("The running daemon uses Rig 1.2.0");
        expect(output).toContain("Restart local daemon? [Y/n]");
    });

    it("does not restart from a noninteractive command", async () => {
        await expect(
            confirmDaemonRestartInTerminal(
                { currentIdentity: { version: "1.3.0" } },
                { input: Readable.from([]) },
            ),
        ).resolves.toBe(false);
    });
});
