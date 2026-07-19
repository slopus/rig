import { watch, type FSWatcher } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { dirname } from "node:path";

export interface ProtectedPathMonitor {
    stop(): Promise<boolean>;
}

export async function createProtectedPathMonitor(
    paths: readonly string[],
): Promise<ProtectedPathMonitor> {
    const protectedPaths = [...new Set(paths)];
    if (protectedPaths.length === 0) return { stop: async () => false };
    const watchers: FSWatcher[] = [];
    let scanning: Promise<void> | undefined;
    let stopped = false;
    let violation = false;
    const scan = async () => {
        for (const path of protectedPaths) {
            try {
                const metadata = await lstat(path);
                violation = true;
                await rm(path, {
                    force: true,
                    recursive: metadata.isDirectory() && !metadata.isSymbolicLink(),
                });
            } catch (error) {
                if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
                    violation = true;
                }
            }
        }
    };
    const scheduleScan = () => {
        if (stopped || scanning !== undefined) return;
        scanning = scan().finally(() => {
            scanning = undefined;
        });
    };

    await scan();
    for (const parent of new Set(protectedPaths.map(dirname))) {
        try {
            const watcher = watch(parent, { persistent: false }, scheduleScan);
            watcher.on("error", scheduleScan);
            watchers.push(watcher);
        } catch {
            // Polling below remains the fail-closed fallback when inotify is unavailable.
        }
    }
    const interval = setInterval(scheduleScan, 1);
    interval.unref();

    return {
        async stop() {
            if (!stopped) {
                stopped = true;
                clearInterval(interval);
                for (const watcher of watchers) watcher.close();
                await scanning;
                await scan();
            }
            return violation;
        },
    };
}
