import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export async function getDevelopmentBuildId(repositoryRoot: string): Promise<string> {
    const files = [
        join(repositoryRoot, "package.json"),
        join(repositoryRoot, "packages/rig/package.json"),
        join(repositoryRoot, "pnpm-lock.yaml"),
        join(repositoryRoot, "tsconfig.base.json"),
        join(repositoryRoot, "packages/rig/tsconfig.build.json"),
        join(repositoryRoot, "packages/rig/tsconfig.json"),
    ];
    const sourceRoot = join(repositoryRoot, "packages/rig/sources");
    const visit = async (directory: string): Promise<void> => {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(path);
            } else if (
                entry.isFile() &&
                entry.name.endsWith(".ts") &&
                !entry.name.endsWith(".test.ts")
            ) {
                files.push(path);
            }
        }
    };
    await visit(sourceRoot);

    const hash = createHash("sha256");
    for (const path of files.sort()) {
        hash.update(relative(repositoryRoot, path));
        hash.update("\0");
        hash.update(await readFile(path));
        hash.update("\0");
    }
    return hash.digest("hex");
}
