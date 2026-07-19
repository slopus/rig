import Dockerode from "dockerode";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DockerEnvironment } from "./DockerEnvironment.js";

describe("DockerEnvironment", () => {
    const inspect = vi.fn();
    const docker = {
        getContainer: vi.fn(() => ({ inspect })),
    } as unknown as Dockerode;

    beforeEach(() => {
        inspect.mockReset();
    });

    it("retries container resolution after a transient failure", async () => {
        inspect
            .mockRejectedValueOnce(new Error("Docker socket was temporarily unavailable."))
            .mockResolvedValueOnce({ State: { Running: true } });
        const environment = new DockerEnvironment(
            { container: "dev", workingDirectory: "/workspace" },
            "session",
            docker,
        );

        await expect(environment.container()).rejects.toThrow("temporarily unavailable");
        await expect(environment.container()).resolves.toBeDefined();
        expect(inspect).toHaveBeenCalledTimes(2);
    });
});
