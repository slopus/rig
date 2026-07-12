import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface TrustDocument {
    decisions: Readonly<Record<string, boolean>>;
    version: 1;
}

export class McpTrustStore {
    readonly #path: string;
    #decisions: Promise<Map<string, boolean>> | undefined;
    #writeQueue = Promise.resolve();

    constructor(path: string) {
        this.#path = path;
    }

    async decision(fingerprint: string): Promise<boolean | undefined> {
        return (await this.#load()).get(fingerprint);
    }

    async remember(fingerprint: string, trusted: boolean): Promise<void> {
        const decisions = await this.#load();
        decisions.set(fingerprint, trusted);
        const write = async () => {
            await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
            const temporaryPath = `${this.#path}.${process.pid}.tmp`;
            const document: TrustDocument = {
                decisions: Object.fromEntries(
                    [...decisions].sort(([left], [right]) => left.localeCompare(right)),
                ),
                version: 1,
            };
            await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
                encoding: "utf8",
                mode: 0o600,
            });
            await rename(temporaryPath, this.#path);
            await chmod(this.#path, 0o600);
        };
        this.#writeQueue = this.#writeQueue.then(write, write);
        await this.#writeQueue;
    }

    async #load(): Promise<Map<string, boolean>> {
        this.#decisions ??= readTrustDocument(this.#path);
        return this.#decisions;
    }
}

async function readTrustDocument(path: string): Promise<Map<string, boolean>> {
    try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<TrustDocument>;
        if (
            parsed.version !== 1 ||
            parsed.decisions === null ||
            typeof parsed.decisions !== "object"
        ) {
            return new Map();
        }
        return new Map(
            Object.entries(parsed.decisions).filter(
                (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
            ),
        );
    } catch {
        return new Map();
    }
}
