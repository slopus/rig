import { resolve } from "node:path";

import { AGENTS_MD_PROJECT_DOC_MAX_BYTES } from "./agentsMdProjectDocMaxBytes.js";
import type { FileSystemContext } from "./context/FileSystemContext.js";
import { findAgentsMdPaths } from "./findAgentsMdPaths.js";
import { formatAgentsMdInstructions } from "./formatAgentsMdInstructions.js";
import { readAgentsMdFile } from "./readAgentsMdFile.js";

export async function loadAgentsMdInstructions(
  fs: FileSystemContext,
): Promise<string | undefined> {
  const paths = await findAgentsMdPaths(fs);
  let remaining = AGENTS_MD_PROJECT_DOC_MAX_BYTES;
  const docs: string[] = [];

  for (const path of paths) {
    const text = await readAgentsMdFile(fs, path, remaining);
    if (text === undefined) continue;

    docs.push(text);
    remaining -= Buffer.byteLength(text);
    if (remaining <= 0) break;
  }

  if (docs.length === 0) return undefined;
  return formatAgentsMdInstructions(resolve(fs.cwd), docs.join("\n\n"));
}
