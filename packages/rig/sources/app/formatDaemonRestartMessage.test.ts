import { describe, expect, it } from "vitest";

import { formatDaemonRestartMessage } from "./formatDaemonRestartMessage.js";

describe("formatDaemonRestartMessage", () => {
    it("describes production version changes", () => {
        expect(
            formatDaemonRestartMessage({
                currentIdentity: { version: "1.3.0" },
                runningIdentity: { version: "1.2.0" },
            }),
        ).toBe(
            "The running daemon uses Rig 1.2.0, but this CLI is Rig 1.3.0. Restart the daemon to use this CLI.",
        );
    });

    it("describes changed development code without exposing build identifiers", () => {
        const message = formatDaemonRestartMessage({
            currentIdentity: { developmentBuildId: "new-build-id", version: "1.2.0" },
            runningIdentity: { developmentBuildId: "old-build-id", version: "1.2.0" },
        });

        expect(message).toContain("development code changed");
        expect(message).not.toContain("new-build-id");
        expect(message).not.toContain("old-build-id");
    });
});
