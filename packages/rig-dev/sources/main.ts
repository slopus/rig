import { fileURLToPath } from "node:url";

import { main } from "../../rig/sources/app/main.js";
import { configureDevelopmentEnvironment } from "../../rig/sources/development/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
await configureDevelopmentEnvironment({ repositoryRoot });

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
