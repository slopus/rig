#!/usr/bin/env node
import { writeCodexGoldens } from "./capture/writeCodexGoldens.js";

const check = process.argv.includes("--check");
const written = await writeCodexGoldens({ check });
for (const path of written) process.stdout.write(`${check ? "Checked" : "Captured"} ${path}\n`);
