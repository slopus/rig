import { describe, expect, it } from "vitest";

import type { DockerEnvironment } from "./DockerEnvironment.js";
import { resolveDockerPath } from "./resolveDockerPath.js";

describe("resolveDockerPath", () => {
    it("rejects relative paths before invoking the Docker daemon", async () => {
        await expect(resolveDockerPath({} as DockerEnvironment, "relative-path")).rejects.toThrow(
            "Docker paths must be absolute before resolution",
        );
    });
});
