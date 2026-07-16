import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { grokListDirTool } from "./list_dir.js";

describe("Grok list_dir tool", () => {
    it("lists dangling symbolic links without failing the directory", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/available.txt": "available" },
        });
        await harness.bash.fs.symlink("missing.txt", "/workspace/dangling.txt");

        const result = await harness.runTool(grokListDirTool, {
            target_directory: "/workspace",
        });

        expect(result.text.split("\n")).toEqual(["available.txt", "dangling.txt"]);
    });
});
