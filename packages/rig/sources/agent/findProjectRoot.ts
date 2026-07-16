import { dirname, join, resolve } from "node:path";

import type { FileSystemContext } from "./context/FileSystemContext.js";

const PROJECT_ROOT_MARKERS = [".git"] as const;

export async function findProjectRoot(fs: FileSystemContext): Promise<string | undefined> {
    let cursor = resolve(fs.cwd);

    for (;;) {
        for (const marker of PROJECT_ROOT_MARKERS) {
            try {
                if (await fs.exists(join(cursor, marker))) {
                    return cursor;
                }
            } catch {
                // Optional discovery must not fail a turn when an ancestor is outside the
                // filesystem context's readable boundary.
            }
        }

        const parent = dirname(cursor);
        if (parent === cursor) {
            return undefined;
        }
        cursor = parent;
    }
}
