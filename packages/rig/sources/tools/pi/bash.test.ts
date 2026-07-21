import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { piBashTool } from "./bash.js";

describe("pi bash tool", () => {
    it("executes commands through the agent context bash", async () => {
        const harness = createJustBashToolHarness();
        const progress: string[] = [];
        const startSession = harness.context.bash.startSession.bind(harness.context.bash);
        let observedTimeout: number | undefined;
        harness.context.bash.startSession = (options) => {
            observedTimeout = options.timeoutMs;
            return startSession(options);
        };

        const result = await piBashTool.execute(
            { command: "printf pi > out.txt && cat out.txt" },
            harness.context,
            { onProgress: (display) => progress.push(display) },
        );

        expect(result.text).toBe("pi");
        expect(await harness.readFile("/workspace/out.txt")).toBe("pi");
        expect(progress).toContain("pi");
        expect(observedTimeout).toBe(120_000);
    });

    it("returns only the bounded output tail and does not promise a missing spill file", async () => {
        const harness = createJustBashToolHarness();
        const outputs = [
            [
                "old-head",
                ...Array.from({ length: 2_001 }, (_, index) => `line-${index + 1}`),
                "new-tail",
            ].join("\n"),
            `old-head-${"x".repeat(60_000)}-new-tail`,
        ];
        harness.context.bash.run = async () => ({
            exitCode: 0,
            stderr: "",
            stdout: outputs.shift() ?? "",
            timedOut: false,
        });
        const lineResult = await piBashTool.execute(
            { command: "produce many lines" },
            harness.context,
            {},
        );

        expect(lineResult.text.includes("old-head")).toBe(false);
        expect(lineResult.text.includes("\nline-4\n")).toBe(false);
        expect(lineResult.text.startsWith("line-5\n")).toBe(true);
        expect(lineResult.text.split("\n").length).toBeLessThanOrEqual(2_000);
        expect(lineResult.text).toContain("new-tail");
        expect(lineResult.text).toContain("Earlier output was truncated");

        const byteResult = await piBashTool.execute(
            { command: "produce many bytes" },
            harness.context,
            {},
        );

        expect(Buffer.byteLength(byteResult.text, "utf8")).toBeLessThanOrEqual(50 * 1_024);
        expect(byteResult.text.includes("old-head")).toBe(false);
        expect(byteResult.text).toContain("new-tail");
        expect(byteResult.text).toContain("Earlier output was truncated");
        expect(piBashTool.description).not.toContain("full output is saved to a temp file");
    });
});
