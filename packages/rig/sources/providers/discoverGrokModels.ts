import { createGrokModelHeaders } from "./createGrokModelHeaders.js";
import { getGrokAuthPath } from "./getGrokAuthPath.js";
import { GROK_DEFAULT_BASE_URL } from "./grok-constants.js";
import { modelXaiGrokBuild } from "./models.js";
import { parseGrokModelCatalog } from "./parseGrokModelCatalog.js";
import { readCachedGrokModels } from "./readCachedGrokModels.js";
import { readGrokAuthStore } from "./readGrokAuthStore.js";
import { resolveGrokCredential } from "./resolveGrokCredential.js";
import { selectGrokAuthRecord } from "./selectGrokAuthRecord.js";
import type { Model } from "./types.js";

export async function discoverGrokModels(
    options: {
        apiKey?: string;
        authFile?: string;
        baseUrl?: string;
        env?: NodeJS.ProcessEnv;
        fetch?: typeof globalThis.fetch;
    } = {},
): Promise<readonly Model[]> {
    const env = options.env ?? process.env;
    const baseUrl = options.baseUrl ?? env.RIG_GROK_BASE_URL ?? GROK_DEFAULT_BASE_URL;
    let fallback: readonly Model[] = [];
    try {
        const credential = await resolveGrokCredential({
            ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
            ...(options.authFile === undefined ? {} : { authFile: options.authFile }),
            env,
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        });
        fallback = await readCachedGrokModels({
            ...(options.authFile === undefined ? {} : { authFile: options.authFile }),
            baseUrl,
            credentialSource: credential.source,
            env,
        });
        const authPath = getGrokAuthPath({
            ...(options.authFile === undefined ? {} : { authFile: options.authFile }),
            env,
        });
        const selected = selectGrokAuthRecord(await readGrokAuthStore(authPath));
        const response = await (options.fetch ?? globalThis.fetch)(
            `${baseUrl.replace(/\/$/u, "")}/models`,
            {
                headers: createGrokModelHeaders({
                    baseUrl,
                    credential,
                    ...(selected === undefined ? {} : { record: selected.record }),
                }),
                signal: AbortSignal.timeout(10_000),
            },
        );
        if (!response.ok) throw new Error(`Grok model discovery failed (${response.status}).`);
        const remote = parseGrokModelCatalog(await response.json());
        return mergeModels([modelXaiGrokBuild], remote.length === 0 ? fallback : remote);
    } catch {
        return mergeModels([modelXaiGrokBuild], fallback);
    }
}

function mergeModels(base: readonly Model[], discovered: readonly Model[]): readonly Model[] {
    const models = new Map(base.map((model) => [model.id, model]));
    for (const model of discovered) models.set(model.id, model);
    return [...models.values()];
}
