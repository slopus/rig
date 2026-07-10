import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FileSearchService } from "./FileSearchService.js";

describe("FileSearchService", () => {
    it("uses FFF to fuzzy-search relative file paths", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "rig-file-search-test-"));
        const service = new FileSearchService();
        try {
            await mkdir(join(cwd, "sources", "components"), { recursive: true });
            await writeFile(join(cwd, "sources", "components", "ChatComposer.tsx"), "export {};");
            await writeFile(join(cwd, "README.md"), "Rig");

            const files = await service.search(cwd, "chtcomp", 10);

            expect(files).toContainEqual({
                fileName: "ChatComposer.tsx",
                path: "sources/components/ChatComposer.tsx",
            });
        } finally {
            service.close();
            await rm(cwd, { force: true, recursive: true });
        }
    });
});
