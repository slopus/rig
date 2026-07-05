import { dirname, join, resolve } from "node:path";

import type { FileSystemContext } from "./context/FileSystemContext.js";

const PROJECT_ROOT_MARKERS = [".git"] as const;

export async function findProjectRoot(
  fs: FileSystemContext,
): Promise<string | undefined> {
  let cursor = resolve(fs.cwd);

  for (;;) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (await fs.exists(join(cursor, marker))) {
        return cursor;
      }
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      return undefined;
    }
    cursor = parent;
  }
}
