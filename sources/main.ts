#!/usr/bin/env node

import { isMainModule } from "./app/isMainModule.js";
import { main } from "./app/main.js";

export { main } from "./app/main.js";

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
