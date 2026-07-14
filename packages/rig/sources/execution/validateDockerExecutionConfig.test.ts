import { describe, expect, it } from "vitest";

import { validateDockerExecutionConfig } from "./validateDockerExecutionConfig.js";

describe("validateDockerExecutionConfig", () => {
    it("rejects malformed mount entries with a human-readable error", () => {
        expect(() =>
            validateDockerExecutionConfig({
                image: "dev:local",
                mounts: [null],
                workingDirectory: "/workspace",
            }),
        ).toThrow("Each Docker mount needs a source and an absolute container target path.");
    });

    it("allows host mount sources that will be resolved relative to the session cwd", () => {
        expect(() =>
            validateDockerExecutionConfig({
                image: "dev:local",
                mounts: [{ source: ".", target: "/workspace" }],
                workingDirectory: "/workspace",
            }),
        ).not.toThrow();
    });
});
