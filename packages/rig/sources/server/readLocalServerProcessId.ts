import { readFile } from "node:fs/promises";

export async function readLocalServerProcessId(path: string): Promise<number | undefined> {
    try {
        const value: unknown = JSON.parse(await readFile(path, "utf8"));
        if (typeof value !== "object" || value === null || !("pid" in value)) return undefined;
        const processId = (value as { pid?: unknown }).pid;
        return typeof processId === "number" && Number.isSafeInteger(processId) && processId > 0
            ? processId
            : undefined;
    } catch {
        return undefined;
    }
}
