import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { piLsTool } from "./ls.js";

describe("pi ls tool", () => {
    it("lists directory contents", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/a.txt": "a",
                "/workspace/dir/b.txt": "b",
            },
        });

        const result = await harness.runTool(piLsTool, {
            path: "/workspace",
        });

        expect(result.text.split("\n")).toEqual(["a.txt", "dir/"]);
    });

    it("lists dangling symbolic links without failing the directory", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/available.txt": "available" },
        });
        await harness.bash.fs.symlink("missing.txt", "/workspace/dangling.txt");

        const result = await harness.runTool(piLsTool, { path: "/workspace" });

        expect(result.text.split("\n")).toEqual(["available.txt", "dangling.txt"]);
    });
});
