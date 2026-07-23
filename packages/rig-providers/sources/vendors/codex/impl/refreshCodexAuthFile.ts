import { randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, unlink } from "node:fs/promises";

import {
    readCodexQuotaAuth,
    type CodexQuotaAuth,
} from "@/vendors/codex/impl/auth.js";

export async function refreshCodexAuthFile(options: {
    authFile: string;
    clientId: string;
    refreshTokenUrl: string;
}): Promise<CodexQuotaAuth> {
    const contents = await readFile(options.authFile, "utf8");
    const parsed = JSON.parse(contents) as {
        last_refresh?: unknown;
        tokens?: {
            access_token?: unknown;
            account_id?: unknown;
            id_token?: unknown;
            refresh_token?: unknown;
        };
    };
    const refreshToken = parsed.tokens?.refresh_token;
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
        throw new Error("Codex authentication is missing a refresh token.");
    }
    const response = await fetch(options.refreshTokenUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            client_id: options.clientId,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        }),
    });
    const body = (await response.json().catch(() => undefined)) as
        | {
              access_token?: unknown;
              error?: unknown;
              error_description?: unknown;
              id_token?: unknown;
              refresh_token?: unknown;
          }
        | undefined;
    if (!response.ok) {
        const detail =
            typeof body?.error_description === "string"
                ? body.error_description
                : typeof body?.error === "string"
                  ? body.error
                  : `${response.status} ${response.statusText}`.trim();
        throw new Error(`Codex access token could not be refreshed: ${detail}`);
    }
    if (typeof body?.access_token !== "string" || body.access_token.length === 0) {
        throw new Error("Codex token refresh did not return an access token.");
    }

    const tokens = (parsed.tokens ??= {});
    tokens.access_token = body.access_token;
    if (typeof body.id_token === "string") tokens.id_token = body.id_token;
    if (typeof body.refresh_token === "string") tokens.refresh_token = body.refresh_token;
    parsed.last_refresh = new Date().toISOString();

    const temporaryPath = `${options.authFile}.${process.pid}.${randomUUID()}.tmp`;
    const temporary = await open(temporaryPath, "wx", 0o600);
    try {
        await temporary.writeFile(`${JSON.stringify(parsed, null, 2)}\n`);
        await temporary.sync();
    } finally {
        await temporary.close();
    }
    try {
        await rename(temporaryPath, options.authFile);
        await chmod(options.authFile, 0o600);
    } finally {
        await unlink(temporaryPath).catch((error: unknown) => {
            if (!hasCode(error, "ENOENT")) throw error;
        });
    }

    const refreshed = readCodexQuotaAuth(JSON.stringify(parsed));
    if (refreshed === undefined)
        throw new Error("Codex authentication was invalid after token refresh.");
    return refreshed;
}

function hasCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
