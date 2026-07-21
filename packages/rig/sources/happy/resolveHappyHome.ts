import { isAbsolute, join } from "node:path";

export function resolveHappyHome(
    environment: NodeJS.ProcessEnv,
    homeDirectory: string,
): string {
    const configured = environment.HAPPY_HOME_DIR?.trim();
    if (!configured) return join(homeDirectory, ".happy");
    const expanded = configured.startsWith("~")
        ? join(homeDirectory, configured.slice(1))
        : configured;
    return isAbsolute(expanded) ? expanded : join(homeDirectory, expanded);
}
