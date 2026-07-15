import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { GrokAuthRecord } from "./grok-auth-types.js";
import { readGrokAuthStore } from "./readGrokAuthStore.js";

export async function writeGrokAuthRecord(options: {
    path: string;
    record: GrokAuthRecord;
    scope: string;
    expectedKey?: string;
}): Promise<GrokAuthRecord> {
    const store = await readGrokAuthStore(options.path);
    const current = store[options.scope];
    if (options.expectedKey !== undefined && current?.key !== options.expectedKey) {
        if (typeof current?.key === "string") return current;
        throw new Error("Grok authentication changed while it was refreshing. Try again.");
    }
    store[options.scope] = options.record;
    await mkdir(dirname(options.path), { mode: 0o700, recursive: true });

    const temporaryPath = `${options.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
        await chmod(temporaryPath, 0o600);
        await rename(temporaryPath, options.path);
        return options.record;
    } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
}
