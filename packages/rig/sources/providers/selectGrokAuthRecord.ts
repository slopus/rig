import {
    GROK_API_KEY_SCOPE,
    GROK_LEGACY_SCOPE,
    GROK_OAUTH_SCOPE,
    type GrokAuthRecord,
    type GrokAuthStore,
} from "./grok-auth-types.js";

export function selectGrokAuthRecord(
    store: GrokAuthStore,
): { record: GrokAuthRecord; scope: string; source: "api-key" | "session" } | undefined {
    const session = store[GROK_OAUTH_SCOPE];
    if (isUsableSession(session)) {
        return { record: session, scope: GROK_OAUTH_SCOPE, source: "session" };
    }

    for (const [scope, record] of Object.entries(store)) {
        if (
            scope !== GROK_API_KEY_SCOPE &&
            scope !== GROK_LEGACY_SCOPE &&
            isUsableSession(record)
        ) {
            return { record, scope, source: "session" };
        }
    }

    const apiKey = store[GROK_API_KEY_SCOPE];
    if (hasKey(apiKey)) {
        return { record: apiKey, scope: GROK_API_KEY_SCOPE, source: "api-key" };
    }

    return undefined;
}

function isUsableSession(record: GrokAuthRecord | undefined): record is GrokAuthRecord {
    return hasKey(record) && record.auth_mode !== "web_login" && record.auth_mode !== "grok";
}

function hasKey(record: GrokAuthRecord | undefined): record is GrokAuthRecord {
    return typeof record?.key === "string" && record.key.trim().length > 0;
}
