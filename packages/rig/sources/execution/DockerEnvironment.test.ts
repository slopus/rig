import { beforeEach, describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => ({
    inspect: vi.fn(),
}));

vi.mock("dockerode", () => ({
    default: class FakeDockerode {
        getContainer() {
            return { inspect: docker.inspect };
        }
    },
}));

import { DockerEnvironment } from "./DockerEnvironment.js";

describe("DockerEnvironment", () => {
    beforeEach(() => {
        docker.inspect.mockReset();
    });

    it("retries container resolution after a transient failure", async () => {
        docker.inspect
            .mockRejectedValueOnce(new Error("Docker socket was temporarily unavailable."))
            .mockResolvedValueOnce({ State: { Running: true } });
        const environment = new DockerEnvironment(
            { container: "dev", workingDirectory: "/workspace" },
            "session",
        );

        await expect(environment.container()).rejects.toThrow("temporarily unavailable");
        await expect(environment.container()).resolves.toBeDefined();
        expect(docker.inspect).toHaveBeenCalledTimes(2);
    });
});
