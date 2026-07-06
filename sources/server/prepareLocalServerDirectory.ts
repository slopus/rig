import { mkdir, chmod } from "node:fs/promises";

export async function prepareLocalServerDirectory(directory: string): Promise<void> {
    await mkdir(directory, { mode: 0o700, recursive: true });
    await chmod(directory, 0o700);
}
