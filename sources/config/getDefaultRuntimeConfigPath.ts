import { homedir } from "node:os";
import { join } from "node:path";

export function getDefaultRuntimeConfigPath(
    env: NodeJS.ProcessEnv = process.env,
    homeDirectory: string = homedir(),
): string {
    const configHome = env.XDG_CONFIG_HOME ?? join(homeDirectory, ".config");
    return join(configHome, "rig", "runtime.toml");
}
