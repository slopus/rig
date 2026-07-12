import { createHash } from "node:crypto";

import type { McpServerConfigEntry } from "./types.js";

export function fingerprintMcpServer(entry: McpServerConfigEntry, workspaceCwd: string): string {
    return createHash("sha256")
        .update(
            stableJson({
                config: entry.config,
                name: entry.name,
                ...(entry.source === "project" ? { workspaceCwd } : {}),
                source: entry.source,
            }),
        )
        .digest("hex");
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
