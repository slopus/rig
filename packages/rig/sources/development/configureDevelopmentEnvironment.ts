import { join } from "node:path";

import { getDevelopmentBuildId } from "./getDevelopmentBuildId.js";

export async function configureDevelopmentEnvironment(options: {
    environment?: NodeJS.ProcessEnv;
    repositoryRoot: string;
}): Promise<void> {
    const environment = options.environment ?? process.env;
    environment.RIG_SERVER_DIRECTORY ??= join(options.repositoryRoot, ".rig-dev");
    environment.RIG_DEVELOPMENT_BUILD_ID ??= await getDevelopmentBuildId(options.repositoryRoot);
}
