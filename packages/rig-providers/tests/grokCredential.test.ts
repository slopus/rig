import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GrokSessionCredential } from "@/vendors/grok/GrokSessionCredential.js";
import { GROK_OAUTH_SCOPE } from "@/vendors/grok/impl/auth.js";

describe("Grok session credential", () => {
    it("refreshes an OIDC token after an unauthorized response", async () => {
        const server = createServer((request, response) => {
            const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
            if (request.url === "/.well-known/openid-configuration") {
                response.setHeader("content-type", "application/json");
                response.end(JSON.stringify({ token_endpoint: `${origin}/token` }));
                return;
            }
            if (request.url === "/token") {
                response.setHeader("content-type", "application/json");
                response.end(
                    JSON.stringify({
                        access_token: "fresh-token",
                        refresh_token: "fresh-refresh-token",
                    }),
                );
                return;
            }
            response.writeHead(404).end();
        });
        server.listen(0, "127.0.0.1");
        await new Promise<void>((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        const address = server.address();
        if (typeof address !== "object" || address === null) throw new Error("Missing port.");
        const directory = await mkdtemp(join(tmpdir(), "rig-grok-auth-"));
        const authFile = join(directory, "auth.json");
        await writeFile(
            authFile,
            JSON.stringify({
                [GROK_OAUTH_SCOPE]: {
                    key: "stale-token",
                    refresh_token: "stale-refresh-token",
                    oidc_issuer: `http://127.0.0.1:${address.port}`,
                    oidc_client_id: "grok-client",
                },
            }),
        );

        try {
            const credential = await GrokSessionCredential.tryLoad({ authFile });
            if (credential === null) throw new Error("Missing credential.");

            await expect(credential.refreshAfterUnauthorized()).resolves.toBe(true);
            expect(credential.credential.token).toBe("fresh-token");
        } finally {
            server.close();
            server.closeAllConnections();
            await rm(directory, { recursive: true, force: true });
        }
    });
});
