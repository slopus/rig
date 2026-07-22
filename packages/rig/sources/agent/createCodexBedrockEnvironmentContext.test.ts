import { describe, expect, it } from "vitest";

import { createCodexBedrockEnvironmentContext } from "./createCodexBedrockEnvironmentContext.js";

describe("createCodexBedrockEnvironmentContext", () => {
    it("escapes workspace values without changing the official XML shape", () => {
        const result = createCodexBedrockEnvironmentContext({
            fs: { cwd: '/workspace/a&b<"c">' },
            permissions: { mode: "workspace_write" },
        } as never);

        expect(result).toContain("<cwd>/workspace/a&amp;b&lt;&quot;c&quot;&gt;</cwd>");
        expect(result).toContain(
            "<workspace_roots><root>/workspace/a&amp;b&lt;&quot;c&quot;&gt;</root></workspace_roots>",
        );
        expect(result).toContain(
            '<permission_profile type="managed"><file_system type="restricted"><entry access="write"><path>/workspace/a&amp;b&lt;&quot;c&quot;&gt;</path></entry></file_system></permission_profile>',
        );
    });

    it("uses Codex's unrestricted profile for full access", () => {
        const result = createCodexBedrockEnvironmentContext({
            fs: { cwd: "/workspace" },
            permissions: { mode: "full_access" },
        } as never);

        expect(result).toContain(
            '<permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile>',
        );
    });

    it("uses Codex's root-readable profile for read only", () => {
        const result = createCodexBedrockEnvironmentContext({
            fs: { cwd: "/workspace" },
            permissions: { mode: "read_only" },
        } as never);

        expect(result).toContain(
            '<permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry></file_system></permission_profile>',
        );
    });
});
