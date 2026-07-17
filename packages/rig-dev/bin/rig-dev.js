#!/usr/bin/env node

import { tsImport } from "tsx/esm/api";

await tsImport("../sources/main.ts", import.meta.url);
