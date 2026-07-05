import { dirname, resolve } from "node:path";

export function buildAncestorDirs(root: string, cwd: string): readonly string[] {
  const normalizedRoot = resolve(root);
  const dirs: string[] = [];
  let cursor = resolve(cwd);

  for (;;) {
    dirs.push(cursor);
    if (cursor === normalizedRoot) break;

    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  return dirs.reverse();
}
