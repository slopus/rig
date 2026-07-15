export const GROK_API_KEY_SCOPE = "xai::api_key";
export const GROK_LEGACY_SCOPE = "https://accounts.x.ai/sign-in";
export const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_OAUTH_ISSUER = "https://auth.x.ai";
export const GROK_OAUTH_SCOPE = `${GROK_OAUTH_ISSUER}::${GROK_OAUTH_CLIENT_ID}`;

export interface GrokAuthRecord {
    auth_mode?: "api_key" | "external" | "grok" | "oidc" | "web_login";
    create_time?: string;
    expires_at?: string;
    key?: string;
    oidc_client_id?: string;
    oidc_issuer?: string;
    principal_id?: string;
    principal_type?: string;
    refresh_token?: string;
    [key: string]: unknown;
}

export type GrokAuthStore = Record<string, GrokAuthRecord>;

export interface GrokCredential {
    source: "api-key" | "session";
    token: string;
}

export interface ResolveGrokCredentialOptions {
    apiKey?: string;
    authFile?: string;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
}
