import { lstat, unlink } from "node:fs/promises";

export async function removeStaleSocket(socketPath: string): Promise<void> {
    let stat;
    try {
        stat = await lstat(socketPath);
    } catch {
        return;
    }

    if (!stat.isSocket()) {
        throw new Error(`Refusing to remove non-socket path: ${socketPath}`);
    }
    if (
        typeof stat.uid === "number" &&
        process.getuid !== undefined &&
        stat.uid !== process.getuid()
    ) {
        throw new Error(`Refusing to remove socket owned by another user: ${socketPath}`);
    }

    await unlink(socketPath);
}
