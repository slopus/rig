import { describe, expect, it } from "vitest";

import { daemonIdentitiesMatch } from "./daemonIdentitiesMatch.js";

describe("daemonIdentitiesMatch", () => {
    it("uses the package version for production daemons", () => {
        expect(daemonIdentitiesMatch({ version: "1.2.3" }, { version: "1.2.3" })).toBe(true);
        expect(daemonIdentitiesMatch({ version: "1.2.3" }, { version: "1.2.2" })).toBe(false);
    });

    it("also requires the current source build in development", () => {
        expect(
            daemonIdentitiesMatch(
                { developmentBuildId: "current", version: "1.2.3" },
                { developmentBuildId: "current", version: "1.2.3" },
            ),
        ).toBe(true);
        expect(
            daemonIdentitiesMatch(
                { developmentBuildId: "current", version: "1.2.3" },
                { developmentBuildId: "older", version: "1.2.3" },
            ),
        ).toBe(false);
    });

    it("treats daemons without identity metadata as stale", () => {
        expect(daemonIdentitiesMatch({ version: "1.2.3" }, undefined)).toBe(false);
    });
});
