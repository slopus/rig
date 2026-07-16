import { describe, expect, it } from "vitest";

import { getDefaultSessionDatabasePath } from "./getDefaultSessionDatabasePath.js";

describe("getDefaultSessionDatabasePath", () => {
    it("stores sessions in RIG_HOME", () => {
        expect(
            getDefaultSessionDatabasePath(
                {
                    RIG_HOME: "/home/tester/rig-home",
                },
                "/home/tester",
            ),
        ).toBe("/home/tester/rig-home/sessions.sqlite");
    });

    it("does not use the legacy XDG state or config locations", () => {
        expect(
            getDefaultSessionDatabasePath(
                {
                    XDG_CONFIG_HOME: "/home/tester/config",
                    XDG_STATE_HOME: "/home/tester/state",
                },
                "/home/tester",
            ),
        ).toBe("/home/tester/.rig/sessions.sqlite");
    });
});
