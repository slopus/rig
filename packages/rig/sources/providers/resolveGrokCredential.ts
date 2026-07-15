import { type GrokCredential, type ResolveGrokCredentialOptions } from "./grok-auth-types.js";
import { getGrokAuthPath } from "./getGrokAuthPath.js";
import { isGrokAuthExpired } from "./isGrokAuthExpired.js";
import { readGrokAuthStore } from "./readGrokAuthStore.js";
import { refreshGrokAuthRecord } from "./refreshGrokAuthRecord.js";
import { selectGrokAuthRecord } from "./selectGrokAuthRecord.js";
import { writeGrokAuthRecord } from "./writeGrokAuthRecord.js";

const activeRefreshes = new Map<string, Promise<GrokCredential>>();

export async function resolveGrokCredential(
    options: ResolveGrokCredentialOptions = {},
): Promise<GrokCredential> {
    if (options.apiKey?.trim()) return { source: "api-key", token: options.apiKey };

    const env = options.env ?? process.env;
    const authPath = getGrokAuthPath({
        ...(options.authFile === undefined ? {} : { authFile: options.authFile }),
        env,
    });
    const selected = selectGrokAuthRecord(await readGrokAuthStore(authPath));
    if (selected !== undefined) {
        if (selected.source === "api-key") {
            return { source: "api-key", token: selected.record.key as string };
        }

        const earlyInvalidationSeconds = Number(env.GROK_AUTH_EARLY_INVALIDATION_SECS ?? 300);
        const earlyInvalidationMs =
            Number.isFinite(earlyInvalidationSeconds) && earlyInvalidationSeconds >= 0
                ? earlyInvalidationSeconds * 1_000
                : 300_000;
        const now = options.now?.() ?? Date.now();
        if (!isGrokAuthExpired(selected.record, { earlyInvalidationMs, now })) {
            return { source: "session", token: selected.record.key as string };
        }

        let refresh = activeRefreshes.get(authPath);
        if (refresh === undefined) {
            refresh = refreshSelectedCredential({
                authPath,
                fetch: options.fetch ?? globalThis.fetch,
                now,
                record: selected.record,
                scope: selected.scope,
            });
            activeRefreshes.set(authPath, refresh);
            void refresh.then(
                () => activeRefreshes.delete(authPath),
                () => activeRefreshes.delete(authPath),
            );
        }
        try {
            return await refresh;
        } catch (error) {
            if (!isGrokAuthExpired(selected.record, { now })) {
                return { source: "session", token: selected.record.key as string };
            }
            throw error;
        }
    }

    if (env.XAI_API_KEY?.trim()) {
        return { source: "api-key", token: env.XAI_API_KEY };
    }

    throw new Error("Grok Build is not signed in. Run `grok login` or set XAI_API_KEY.");
}

async function refreshSelectedCredential(options: {
    authPath: string;
    fetch: typeof globalThis.fetch;
    now: number;
    record: Parameters<typeof refreshGrokAuthRecord>[0]["record"];
    scope: string;
}): Promise<GrokCredential> {
    const record = await refreshGrokAuthRecord({
        fetch: options.fetch,
        now: options.now,
        record: options.record,
    });
    const stored = await writeGrokAuthRecord({
        path: options.authPath,
        record,
        scope: options.scope,
        ...(typeof options.record.key === "string" ? { expectedKey: options.record.key } : {}),
    });
    return { source: "session", token: stored.key as string };
}
