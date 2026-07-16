import { readPackageVersion } from "../readPackageVersion.js";
import type { DaemonIdentity } from "../protocol/index.js";

export function getDaemonIdentity(
    environment: NodeJS.ProcessEnv = process.env,
    version: string = readPackageVersion(),
): DaemonIdentity {
    const developmentBuildId = environment.RIG_DEVELOPMENT_BUILD_ID?.trim();
    return {
        version,
        ...(developmentBuildId === undefined || developmentBuildId.length === 0
            ? {}
            : { developmentBuildId }),
    };
}
