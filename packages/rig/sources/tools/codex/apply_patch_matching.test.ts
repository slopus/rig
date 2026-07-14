import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { codexApplyPatchTool } from "./apply_patch.js";

describe("codex apply_patch hunk locations", () => {
    it("uses optional context anchors and end-of-file markers", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/anchored.txt": [
                    "function first()",
                    "return old",
                    "function second()",
                    "return old",
                    "tail",
                    "middle",
                    "tail",
                    "",
                ].join("\n"),
            },
        });

        await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: [
                "*** Begin Patch",
                "*** Update File: anchored.txt",
                "@@ function second()",
                "-return old",
                "+return new",
                "@@",
                "-tail",
                "+last tail",
                "*** End of File",
                "*** End Patch",
            ].join("\n"),
        });

        expect(await harness.readFile("/workspace/anchored.txt")).toBe(
            [
                "function first()",
                "return old",
                "function second()",
                "return new",
                "tail",
                "middle",
                "last tail",
                "",
            ].join("\n"),
        );
    });

    it("accepts Codex-style whitespace-tolerant whole-line context", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/spacing.txt": "    before();   \n" },
        });

        await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: [
                "*** Begin Patch",
                "*** Update File: spacing.txt",
                "@@",
                "-before();",
                "+after();",
                "*** End Patch",
            ].join("\n"),
        });

        expect(await harness.readFile("/workspace/spacing.txt")).toBe("after();\n");
    });
});
