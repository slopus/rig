import { describe, expect, it } from "vitest";

import type { AnyDefinedTool } from "../agent/types.js";
import { replaceExternalTools, type ExternalToolInstallation } from "./replaceExternalTools.js";

describe("replaceExternalTools", () => {
    it("restores a shadowed native tool when its external replacement is removed", () => {
        const native = tool("lookup_ticket", "native");
        const other = tool("read_file", "native");
        const firstExternal = tool("lookup_ticket", "external-1");
        const secondExternal = tool("lookup_ticket", "external-2");
        const empty: ExternalToolInstallation = {
            installed: new Set(),
            shadowed: new Map(),
        };

        const first = replaceExternalTools([native, other], [firstExternal], empty);
        expect(first.tools).toEqual([other, firstExternal]);

        const replaced = replaceExternalTools(first.tools, [secondExternal], first.installation);
        expect(replaced.tools).toEqual([other, secondExternal]);

        const removed = replaceExternalTools(replaced.tools, [], replaced.installation);
        expect(removed.tools).toEqual([other, native]);
    });
});

function tool(name: string, marker: string): AnyDefinedTool {
    return { name, marker } as unknown as AnyDefinedTool;
}
