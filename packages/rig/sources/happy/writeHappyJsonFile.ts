import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeHappyJsonFile(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { mode: 0o700, recursive: true });
    await chmod(dirname(path), 0o700);
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
        await chmod(temporaryPath, 0o600);
        await rename(temporaryPath, path);
        await chmod(path, 0o600);
    } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
}
