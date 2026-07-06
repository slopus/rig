import { readFile } from "node:fs/promises";

export async function readLocalServerToken(tokenPath: string): Promise<string> {
    return (await readFile(tokenPath, "utf8")).trim();
}
