import { join } from "node:path";

export function createUserSkillRootPaths(homeDirectory: string): readonly string[] {
    return [join(homeDirectory, ".codex", "skills"), join(homeDirectory, ".agents", "skills")];
}
