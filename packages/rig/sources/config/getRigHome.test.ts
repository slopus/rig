import { describe, expect, it } from "vitest";

import { getRigHome } from "./getRigHome.js";

describe("getRigHome", () => {
    it("defaults to the .rig directory in the user's home", () => {
        expect(getRigHome({}, "/home/tester")).toBe("/home/tester/.rig");
    });

    it("honors an absolute RIG_HOME", () => {
        expect(getRigHome({ RIG_HOME: "/private/rig" }, "/home/tester")).toBe("/private/rig");
    });

    it("does not use legacy XDG locations", () => {
        expect(
            getRigHome(
                {
                    XDG_CONFIG_HOME: "/private/config",
                    XDG_STATE_HOME: "/private/state",
                },
                "/home/tester",
            ),
        ).toBe("/home/tester/.rig");
    });

    it.each(["", "   "])("uses the default for an empty RIG_HOME", (configuredHome) => {
        expect(getRigHome({ RIG_HOME: configuredHome }, "/home/tester")).toBe("/home/tester/.rig");
    });

    it("rejects a relative RIG_HOME", () => {
        expect(() => getRigHome({ RIG_HOME: "relative/rig" }, "/home/tester")).toThrow(
            "RIG_HOME must be an absolute path.",
        );
    });
});
