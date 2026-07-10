import { LRUCache } from "lru-cache";

import type { WebFetchContent } from "./types.js";

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024;

export const webFetchUrlCache = new LRUCache<string, WebFetchContent>({
    maxSize: MAX_CACHE_SIZE_BYTES,
    ttl: CACHE_TTL_MS,
});

export const webFetchDomainCache = new LRUCache<string, true>({
    max: 128,
    ttl: 5 * 60 * 1000,
});

export function clearWebFetchCache(): void {
    webFetchUrlCache.clear();
    webFetchDomainCache.clear();
}
