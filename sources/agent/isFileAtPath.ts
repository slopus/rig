import type { FileSystemContext } from "./context/FileSystemContext.js";

export async function isFileAtPath(
  fs: FileSystemContext,
  path: string,
): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile;
  } catch {
    return false;
  }
}
