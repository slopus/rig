import { readFile } from "node:fs/promises";

import type { GrokAuthStore } from "./grok-auth-types.js";

export async function readGrokAuthStore(path: string): Promise<GrokAuthStore> {
    let source: string;
    try {
        source = await readFile(path, "utf8");
    } catch (error) {
        if (isFileNotFound(error)) return {};
        throw error;
    }

    if (source.trim().length === 0) return {};
    const value: unknown = JSON.parse(source);
    if (value === null || Array.isArray(value) || typeof value !== "object") {
        throw new Error(`Grok authentication file is not a JSON object: ${path}`);
    }
    return value as GrokAuthStore;
}

function isFileNotFound(error: unknown): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
    );
}
