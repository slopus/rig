import type { FileSystemContext } from "./context/FileSystemContext.js";

export async function readAgentsMdFile(
  fs: FileSystemContext,
  path: string,
  maxBytes: number,
): Promise<string | undefined> {
  if (maxBytes <= 0) return undefined;

  const buffer = await fs.readFileBuffer(path);
  const truncated = buffer.byteLength > maxBytes
    ? buffer.slice(0, maxBytes)
    : buffer;
  const text = Buffer.from(truncated).toString("utf8");

  return text.trim().length > 0 ? text : undefined;
}
