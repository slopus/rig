import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function getDefaultMcpTrustPath(
    environment: NodeJS.ProcessEnv = process.env,
    homeDirectory: string = homedir(),
): string {
    const configuredDirectory = environment.XDG_CONFIG_HOME;
    const configDirectory =
        configuredDirectory && isAbsolute(configuredDirectory)
            ? configuredDirectory
            : join(homeDirectory, ".config");
    return join(configDirectory, "rig", "mcp-trust.json");
}
