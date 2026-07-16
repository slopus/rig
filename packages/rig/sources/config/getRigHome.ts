import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function getRigHome(
    environment: NodeJS.ProcessEnv = process.env,
    homeDirectory: string = homedir(),
): string {
    const configuredHome = environment.RIG_HOME?.trim();
    if (!configuredHome) {
        return join(homeDirectory, ".rig");
    }
    if (!isAbsolute(configuredHome)) {
        throw new Error("RIG_HOME must be an absolute path.");
    }
    return configuredHome;
}
