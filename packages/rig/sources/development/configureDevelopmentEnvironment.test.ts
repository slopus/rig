import { describe, expect, it } from "vitest";

import { configureDevelopmentEnvironment } from "./configureDevelopmentEnvironment.js";

describe("configureDevelopmentEnvironment", () => {
    it("places the daemon in the current folder", async () => {
        const environment = { RIG_DEVELOPMENT_BUILD_ID: "existing-build" };

        await configureDevelopmentEnvironment({
            cwd: "/workspace/rig",
            environment,
            repositoryRoot: "/unused",
        });

        expect(environment).toEqual({
            RIG_DEVELOPMENT_BUILD_ID: "existing-build",
            RIG_SERVER_DIRECTORY: "/workspace/rig/.rig-dev",
        });
    });
});
