#!/usr/bin/env node

import { main } from "./app/main.js";
import { reportCliFailure } from "./reportCliFailure.js";

main().catch(reportCliFailure);
