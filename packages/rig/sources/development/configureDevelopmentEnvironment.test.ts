import { describe, expect, it } from "vitest";

import { configureDevelopmentEnvironment } from "./configureDevelopmentEnvironment.js";

describe("configureDevelopmentEnvironment", () => {
    it("places the daemon in the development checkout", async () => {
        const environment = { RIG_DEVELOPMENT_BUILD_ID: "existing-build" };

        await configureDevelopmentEnvironment({
            environment,
            repositoryRoot: "/workspace/rig",
        });

        expect(environment).toEqual({
            RIG_DEVELOPMENT_BUILD_ID: "existing-build",
            RIG_SERVER_DIRECTORY: "/workspace/rig/.rig-dev",
        });
    });
});
