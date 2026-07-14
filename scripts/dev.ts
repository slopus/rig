import { fileURLToPath } from "node:url";

import { main } from "../packages/rig/sources/app/main.js";
import { configureDevelopmentEnvironment } from "../packages/rig/sources/development/index.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
await configureDevelopmentEnvironment({
    cwd: process.cwd(),
    repositoryRoot,
});

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
