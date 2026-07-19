import { describe, expect, it } from "vitest";

import { dockerSandboxArguments } from "./sharedDockerRunner.js";

describe("dockerSandboxArguments", () => {
    it("hides the shared fixture and state pools from each sandbox", () => {
        expect(
            dockerSandboxArguments("/gyms/fixture", "/gym-state/fixture", ["node", "rig.js"]),
        ).toEqual([
            "bwrap",
            "--unshare-user",
            "--unshare-ipc",
            "--unshare-uts",
            "--bind",
            "/",
            "/",
            "--dev",
            "/dev",
            "--bind",
            "/gyms/fixture/workspace",
            "/workspace",
            "--bind",
            "/gyms/fixture/home",
            "/home/rig",
            "--bind",
            "/gym-state/fixture/tmp",
            "/tmp",
            "--tmpfs",
            "/gyms",
            "--tmpfs",
            "/gym-state",
            "--chdir",
            "/workspace",
            "--",
            "node",
            "rig.js",
        ]);
    });
});
