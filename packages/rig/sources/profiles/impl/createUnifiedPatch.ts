import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createUnifiedPatch(options: {
    after: string;
    afterName: string;
    before: string;
    beforeName: string;
}): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "rig-profile-patch-"));
    try {
        await writeFile(join(directory, options.beforeName), options.before, "utf8");
        await writeFile(join(directory, options.afterName), options.after, "utf8");
        try {
            await execFileAsync(
                "git",
                [
                    "diff",
                    "--no-index",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--diff-algorithm=myers",
                    "--src-prefix=a/",
                    "--dst-prefix=b/",
                    "--",
                    options.beforeName,
                    options.afterName,
                ],
                { cwd: directory },
            );
            return "";
        } catch (error) {
            const candidate = error as { code?: number; stdout?: string };
            if (candidate.code !== 1 || candidate.stdout === undefined) throw error;
            return candidate.stdout;
        }
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
}
