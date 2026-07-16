import { join, resolve } from "node:path";

import { buildAncestorDirs } from "../buildAncestorDirs.js";
import type { FileSystemContext } from "../context/FileSystemContext.js";
import { createUserSkillRootPaths } from "../context/createUserSkillRootPaths.js";
import { findProjectRoot } from "../findProjectRoot.js";
import { isDirectoryAtPath } from "./isDirectoryAtPath.js";

// Match Codex discovery roots only. Rig intentionally does not interpret Claude or Pi skill trees.
const PROJECT_SKILL_DIRS = [".agents/skills"] as const;

export async function findSkillRootPaths(fs: FileSystemContext): Promise<readonly string[]> {
    const cwd = resolve(fs.cwd);
    const projectRoot = await findProjectRoot(fs);
    const dirs = projectRoot === undefined ? [cwd] : buildAncestorDirs(projectRoot, cwd);
    const paths: string[] = [];

    if (fs.home !== undefined) {
        for (const candidate of createUserSkillRootPaths(resolve(fs.home))) {
            if (await isDirectoryAtPath(fs, candidate)) {
                paths.push(candidate);
            }
        }
    }

    for (const dir of dirs) {
        for (const skillDir of PROJECT_SKILL_DIRS) {
            const candidate = join(dir, skillDir);
            if (await isDirectoryAtPath(fs, candidate)) {
                paths.push(candidate);
            }
        }
    }

    return paths;
}
