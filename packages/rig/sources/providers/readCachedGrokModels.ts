import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getGrokAuthPath } from "./getGrokAuthPath.js";
import type { GrokCredential } from "./grok-auth-types.js";
import { parseGrokModelCatalog } from "./parseGrokModelCatalog.js";
import type { Model } from "./types.js";

const GROK_MODEL_CACHE_TTL_MS = 5 * 60 * 1_000;

export async function readCachedGrokModels(options: {
    authFile?: string;
    baseUrl: string;
    credentialSource: GrokCredential["source"];
    env?: NodeJS.ProcessEnv;
    now?: () => number;
}): Promise<readonly Model[]> {
    const authPath = getGrokAuthPath({
        ...(options.authFile === undefined ? {} : { authFile: options.authFile }),
        ...(options.env === undefined ? {} : { env: options.env }),
    });
    try {
        const source = JSON.parse(
            await readFile(join(dirname(authPath), "models_cache.json"), "utf8"),
        ) as unknown;
        const cache = source as {
            auth_method?: unknown;
            fetched_at?: unknown;
            origin?: unknown;
        };
        const expectedOrigin = `${options.baseUrl.replace(/\/$/u, "")}/models`;
        if (cache?.origin !== expectedOrigin) return [];
        const expectedAuthMethod = options.credentialSource === "session" ? "session" : "api_key";
        if (cache.auth_method !== expectedAuthMethod) return [];
        if (typeof cache.fetched_at !== "string") return [];
        const fetchedAt = Date.parse(cache.fetched_at);
        const age = (options.now?.() ?? Date.now()) - fetchedAt;
        if (!Number.isFinite(fetchedAt) || age < 0 || age >= GROK_MODEL_CACHE_TTL_MS) return [];
        return parseGrokModelCatalog(source);
    } catch {
        return [];
    }
}
