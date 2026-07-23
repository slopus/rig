import { BaseCredential } from "@/core/BaseCredential.js";
import { GROK_OAUTH_SCOPE, getGrokAuthPath, readGrokAuthStore } from "@/vendors/grok/impl/auth.js";

export type GrokSessionCredentialValue = {
    readonly source: "session";
    token: string;
};

export interface GrokSessionCredentialLoadOptions {
    authFile?: string;
    env?: NodeJS.ProcessEnv;
}

export class GrokSessionCredential extends BaseCredential<
    "grok-session",
    GrokSessionCredentialValue
> {
    private readonly authPath: string;
    private record: Record<string, unknown>;

    static async tryLoad(
        options: GrokSessionCredentialLoadOptions = {},
    ): Promise<GrokSessionCredential | null> {
        const env = options.env ?? process.env;
        const authPath = getGrokAuthPath({
            ...(options.authFile === undefined ? {} : { authFile: options.authFile }),
            env,
        });
        const store = await readGrokAuthStore(authPath);
        const session = store[GROK_OAUTH_SCOPE];
        if (typeof session?.key !== "string" || session.key.trim().length === 0) {
            return null;
        }

        return new GrokSessionCredential(
            { source: "session", token: session.key },
            authPath,
            session,
        );
    }

    async refreshAfterUnauthorized(): Promise<boolean> {
        const store = await readGrokAuthStore(this.authPath);
        const disk = store[GROK_OAUTH_SCOPE];
        if (typeof disk?.key === "string" && disk.key !== this.credential.token) {
            this.credential.token = disk.key;
            this.record = disk;
            return true;
        }

        const refreshToken = stringField(this.record, "refresh_token");
        const issuer = stringField(this.record, "oidc_issuer");
        const clientId = stringField(this.record, "oidc_client_id");
        if (refreshToken === undefined || issuer === undefined || clientId === undefined) {
            return false;
        }
        const discovery = await fetch(
            `${issuer.replace(/\/$/u, "")}/.well-known/openid-configuration`,
        );
        if (!discovery.ok) return false;
        const metadata = (await discovery.json()) as { token_endpoint?: unknown };
        if (typeof metadata.token_endpoint !== "string") return false;
        const response = await fetch(metadata.token_endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: clientId,
            }),
        });
        if (!response.ok) return false;
        const tokens = (await response.json()) as {
            access_token?: unknown;
            refresh_token?: unknown;
        };
        if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) {
            return false;
        }
        this.credential.token = tokens.access_token;
        this.record = {
            ...this.record,
            key: tokens.access_token,
            ...(typeof tokens.refresh_token === "string"
                ? { refresh_token: tokens.refresh_token }
                : {}),
        };
        return true;
    }

    private constructor(
        credential: GrokSessionCredentialValue,
        authPath: string,
        record: Record<string, unknown>,
    ) {
        super("grok-session", credential);
        this.authPath = authPath;
        this.record = record;
    }
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
    const value = record[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
