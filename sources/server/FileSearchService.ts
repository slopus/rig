import { FileFinder } from "@ff-labs/fff-node";
import { resolve } from "node:path";

import type { FileSearchResult } from "../protocol/index.js";

const DEFAULT_MAX_INDEXES = 8;
const INITIAL_SCAN_TIMEOUT_MS = 5_000;

interface FinderState {
    finder: FileFinder;
    ready: Promise<void>;
}

export interface FileSearchServiceContract {
    close(): void;
    search(cwd: string, query: string, limit: number): Promise<readonly FileSearchResult[]>;
}

export class FileSearchService implements FileSearchServiceContract {
    readonly #finders = new Map<string, FinderState>();
    readonly #maxIndexes: number;

    constructor(options: { maxIndexes?: number } = {}) {
        this.#maxIndexes = Math.max(1, options.maxIndexes ?? DEFAULT_MAX_INDEXES);
    }

    close(): void {
        for (const state of this.#finders.values()) {
            state.finder.destroy();
        }
        this.#finders.clear();
    }

    async search(cwd: string, query: string, limit: number): Promise<readonly FileSearchResult[]> {
        const state = this.#finderFor(cwd);
        await state.ready;

        const result = state.finder.fileSearch(query, { pageSize: limit });
        if (!result.ok) {
            throw new Error(`File search failed: ${result.error}`);
        }

        return result.value.items.map((item) => ({
            fileName: item.fileName,
            path: item.relativePath,
        }));
    }

    #finderFor(cwd: string): FinderState {
        const basePath = resolve(cwd);
        const existing = this.#finders.get(basePath);
        if (existing !== undefined) {
            this.#finders.delete(basePath);
            this.#finders.set(basePath, existing);
            return existing;
        }

        const created = FileFinder.create({
            aiMode: true,
            basePath,
            disableContentIndexing: true,
            disableMmapCache: true,
        });
        if (!created.ok) {
            throw new Error(`File search could not index this workspace: ${created.error}`);
        }

        const finder = created.value;
        const state: FinderState = {
            finder,
            ready: finder.waitForScan(INITIAL_SCAN_TIMEOUT_MS).then((result) => {
                if (!result.ok) {
                    throw new Error(`File search could not scan this workspace: ${result.error}`);
                }
            }),
        };
        this.#finders.set(basePath, state);
        this.#removeOldestIndex();
        return state;
    }

    #removeOldestIndex(): void {
        if (this.#finders.size <= this.#maxIndexes) {
            return;
        }

        const oldestPath = this.#finders.keys().next().value as string | undefined;
        if (oldestPath === undefined) {
            return;
        }

        const oldest = this.#finders.get(oldestPath);
        this.#finders.delete(oldestPath);
        oldest?.finder.destroy();
    }
}
