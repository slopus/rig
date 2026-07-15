import { join } from "node:path";

export function getDebugRootDirectory(cwd: string): string {
    return join(cwd, ".rig", "debug");
}
