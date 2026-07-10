import { homedir } from "node:os";
import { join } from "node:path";

export function getDefaultSessionDatabasePath(
    env: NodeJS.ProcessEnv = process.env,
    homeDirectory: string = homedir(),
): string {
    const stateHome = env.XDG_STATE_HOME ?? join(homeDirectory, ".local", "state");
    return join(stateHome, "rig", "sessions.sqlite");
}
