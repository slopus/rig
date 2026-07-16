import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const materializations = new Map<string, Promise<void>>();

export async function materializeSandboxConfig(
    configDirectory: string,
    config: unknown,
): Promise<string> {
    const contents = JSON.stringify(config);
    const key = createHash("sha256").update(contents).digest("hex");
    const configPath = join(configDirectory, `${key}.json`);
    let pending = materializations.get(configPath);
    if (pending === undefined) {
        pending = writeFile(configPath, contents, { mode: 0o600 });
        materializations.set(configPath, pending);
    }
    try {
        await pending;
    } catch (error) {
        if (materializations.get(configPath) === pending) materializations.delete(configPath);
        throw error;
    }
    return configPath;
}
