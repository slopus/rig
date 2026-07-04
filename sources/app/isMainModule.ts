import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function isMainModule(metaUrl: string, argv: readonly string[] = process.argv): boolean {
  const entry = argv[1];
  return entry !== undefined && metaUrl === pathToFileURL(resolve(entry)).href;
}
