import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { piBashTool } from "./bash.js";

describe("pi bash tool", () => {
    it("executes commands through the agent context bash", async () => {
        const harness = createJustBashToolHarness();
        const progress: string[] = [];

        const result = await piBashTool.execute(
            { command: "printf pi > out.txt && cat out.txt" },
            harness.context,
            { onProgress: (display) => progress.push(display) },
        );

        expect(result.text).toBe("pi");
        expect(await harness.readFile("/workspace/out.txt")).toBe("pi");
        expect(progress).toContain("pi");
    });
});
