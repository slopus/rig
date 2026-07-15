import type { GrokAuthRecord } from "./grok-auth-types.js";

interface OidcDiscovery {
    token_endpoint?: string;
}

interface TokenResponse {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
}

export async function refreshGrokAuthRecord(options: {
    fetch: typeof globalThis.fetch;
    now: number;
    record: GrokAuthRecord;
}): Promise<GrokAuthRecord> {
    const issuer = options.record.oidc_issuer;
    const clientId = options.record.oidc_client_id;
    const refreshToken = options.record.refresh_token;
    if (!issuer || !clientId || !refreshToken) {
        throw new Error("The Grok session cannot be refreshed. Run `grok login` again.");
    }

    const discoveryResponse = await options.fetch(
        `${issuer.replace(/\/$/u, "")}/.well-known/openid-configuration`,
        { signal: AbortSignal.timeout(10_000) },
    );
    if (!discoveryResponse.ok) {
        throw new Error(`Grok sign-in discovery failed (${discoveryResponse.status}).`);
    }
    const discovery = (await discoveryResponse.json()) as OidcDiscovery;
    if (!discovery.token_endpoint) {
        throw new Error("Grok sign-in discovery did not return a token endpoint.");
    }

    const body = new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });
    if (options.record.principal_type) body.set("principal_type", options.record.principal_type);
    if (options.record.principal_id) body.set("principal_id", options.record.principal_id);
    const tokenResponse = await options.fetch(discovery.token_endpoint, {
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) {
        throw new Error(`Grok sign-in refresh failed (${tokenResponse.status}).`);
    }
    const tokens = (await tokenResponse.json()) as TokenResponse;
    if (!tokens.access_token) {
        throw new Error("Grok sign-in refresh did not return an access token.");
    }

    const createTime = new Date(options.now).toISOString();
    const refreshed: GrokAuthRecord = {
        ...options.record,
        create_time: createTime,
        key: tokens.access_token,
        refresh_token: tokens.refresh_token ?? refreshToken,
    };
    if (typeof tokens.expires_in === "number") {
        refreshed.expires_at = new Date(options.now + tokens.expires_in * 1_000).toISOString();
    } else {
        delete refreshed.expires_at;
    }
    return refreshed;
}
