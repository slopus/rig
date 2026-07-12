import { describe, expect, it } from "vitest";

import { createSensitiveReadPaths } from "./createSensitiveReadPaths.js";

describe("createSensitiveReadPaths", () => {
    it.each([undefined, "", "relative/config"])(
        "falls back to the private home config directory for %s XDG_CONFIG_HOME",
        (configuredDirectory) => {
            const paths = createSensitiveReadPaths({
                environment: { XDG_CONFIG_HOME: configuredDirectory },
                homeDirectory: "/home/tester",
                temporaryDirectory: "/tmp",
                uid: 501,
            });

            expect(paths).toContain("/home/tester/.config/gh");
            expect(paths).not.toContain("relative/config/gh");
        },
    );

    it("honors an absolute XDG config directory", () => {
        const paths = createSensitiveReadPaths({
            environment: { XDG_CONFIG_HOME: "/private/config" },
            homeDirectory: "/home/tester",
            temporaryDirectory: "/tmp",
            uid: 501,
        });

        expect(paths).toContain("/private/config/gh");
    });
});
