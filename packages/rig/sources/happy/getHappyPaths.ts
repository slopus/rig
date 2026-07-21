import { join } from "node:path";

export interface HappyPaths {
    credentialsPath: string;
    directory: string;
    settingsPath: string;
}

export function getHappyPaths(rigHome: string): HappyPaths {
    const directory = join(rigHome, "happy");
    return {
        credentialsPath: join(directory, "access.key"),
        directory,
        settingsPath: join(directory, "settings.json"),
    };
}
