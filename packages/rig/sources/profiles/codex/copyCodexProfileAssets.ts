#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CODEX_PROFILE_ARTIFACTS } from "./types.js";

const suffixes = [
    ".capture.json",
    ".golden.md",
    ".md",
    ".patch",
    ".tools.golden.json",
    ".tools.json",
    ".tools.patch",
] as const;

export async function copyCodexProfileAssets(destinationDirectory: string): Promise<void> {
    const sourceDirectory = dirname(fileURLToPath(import.meta.url));
    await mkdir(destinationDirectory, { recursive: true });
    for (const profile of CODEX_PROFILE_ARTIFACTS) {
        for (const suffix of suffixes) {
            const fileName = `${profile.stem}${suffix}`;
            await copyFile(join(sourceDirectory, fileName), join(destinationDirectory, fileName));
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await copyCodexProfileAssets(
        fileURLToPath(new URL("../../../dist/profiles/codex/", import.meta.url)),
    );
}
