import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LOCK_STALE_AFTER_MS = 30_000;
const LOCK_WAIT_MS = 10;

/** Resolves one installation ID with an inter-process lock and durable atomic write. */
export async function resolveCodexInstallationIdAt(codexHome: string): Promise<string> {
    await mkdir(codexHome, { recursive: true });
    const path = join(codexHome, "installation_id");
    const lockPath = `${path}.lock`;

    for (;;) {
        const existing = await readValid(path);
        if (existing !== undefined) {
            await chmod(path, 0o644);
            return existing;
        }

        let lock;
        try {
            lock = await open(lockPath, "wx", 0o600);
        } catch (error) {
            if (!hasCode(error, "EEXIST")) throw error;
            try {
                const lockStat = await stat(lockPath);
                if (Date.now() - lockStat.mtimeMs > LOCK_STALE_AFTER_MS) {
                    await unlink(lockPath);
                    continue;
                }
            } catch (statError) {
                if (!hasCode(statError, "ENOENT")) throw statError;
            }
            await delay(LOCK_WAIT_MS);
            continue;
        }

        const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
        try {
            const lockedExisting = await readValid(path);
            if (lockedExisting !== undefined) return lockedExisting;

            const installationId = randomUUID();
            const temporary = await open(temporaryPath, "wx", 0o644);
            try {
                await temporary.writeFile(installationId);
                await temporary.sync();
            } finally {
                await temporary.close();
            }
            await rename(temporaryPath, path);
            await chmod(path, 0o644);
            try {
                const directory = await open(codexHome, "r");
                try {
                    await directory.sync();
                } finally {
                    await directory.close();
                }
            } catch {
                // Some platforms cannot fsync directories; the file itself is already durable.
            }
            return installationId;
        } finally {
            await unlink(temporaryPath).catch((error: unknown) => {
                if (!hasCode(error, "ENOENT")) throw error;
            });
            await lock.close();
            await unlink(lockPath).catch((error: unknown) => {
                if (!hasCode(error, "ENOENT")) throw error;
            });
        }
    }
}

async function readValid(path: string): Promise<string | undefined> {
    try {
        const value = (await readFile(path, "utf8")).trim().toLowerCase();
        return UUID_PATTERN.test(value) ? value : undefined;
    } catch (error) {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
    }
}

function hasCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
