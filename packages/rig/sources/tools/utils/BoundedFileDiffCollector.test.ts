import { describe, expect, it } from "vitest";

import { BoundedFileDiffCollector } from "./BoundedFileDiffCollector.js";

describe("BoundedFileDiffCollector", () => {
    it("shares one line budget across files and does not consume omitted file content", () => {
        const collector = new BoundedFileDiffCollector();
        collector.add({
            hunks: [
                {
                    lines: Array.from({ length: 400 }, (_, index) => ({
                        kind: "add" as const,
                        text: `first ${index}`,
                    })),
                    newStart: 1,
                    oldStart: 0,
                },
            ],
            kind: "add",
            path: "first.txt",
        });
        collector.add({
            hunks: [
                {
                    lines: Array.from({ length: 200 }, (_, index) => ({
                        kind: "delete" as const,
                        text: `second ${index}`,
                    })),
                    newStart: 0,
                    oldStart: 1,
                },
            ],
            kind: "delete",
            path: "second.txt",
        });
        for (let index = 2; index < 20; index++) {
            collector.addWholeFile(`empty-${index}.txt`, "add", []);
        }
        let consumed = false;
        function* omittedContent(): Generator<string> {
            consumed = true;
            yield "must not be read";
        }
        collector.addWholeFile("omitted.txt", "delete", omittedContent());

        const result = collector.finish();

        expect(result.files).toHaveLength(20);
        expect(result.omittedFiles).toBe(1);
        expect(consumed).toBe(false);
        expect(result.files[0]?.hunks[0]?.lines).toHaveLength(400);
        expect(result.files[1]).toMatchObject({
            added: 0,
            deleted: 200,
            omittedLines: 100,
        });
        expect(result.files[1]?.hunks[0]?.lines).toHaveLength(100);
    });
});
