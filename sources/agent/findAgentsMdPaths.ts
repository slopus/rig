import { join, resolve } from "node:path";

import { buildAncestorDirs } from "./buildAncestorDirs.js";
import type { FileSystemContext } from "./context/FileSystemContext.js";
import { findProjectRoot } from "./findProjectRoot.js";
import { isFileAtPath } from "./isFileAtPath.js";

const AGENTS_MD_FILENAME = "AGENTS.md";

export async function findAgentsMdPaths(
  fs: FileSystemContext,
): Promise<readonly string[]> {
  const cwd = resolve(fs.cwd);
  const projectRoot = await findProjectRoot(fs);
  const dirs =
    projectRoot === undefined ? [cwd] : buildAncestorDirs(projectRoot, cwd);
  const paths: string[] = [];

  for (const dir of dirs) {
    const candidate = join(dir, AGENTS_MD_FILENAME);
    if (await isFileAtPath(fs, candidate)) {
      paths.push(candidate);
    }
  }

  return paths;
}
