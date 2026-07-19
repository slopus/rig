import { fileURLToPath } from "node:url";

import { main } from "../../rig/sources/app/main.js";
import { configureDevelopmentEnvironment } from "../../rig/sources/development/index.js";

// pnpm runs package scripts from the package directory; start the session in
// the directory the developer actually invoked `pnpm dev` from.
const invokedFrom = process.env.INIT_CWD?.trim();
if (invokedFrom !== undefined && invokedFrom.length > 0) {
    process.chdir(invokedFrom);
}

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
await configureDevelopmentEnvironment({ repositoryRoot });

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
