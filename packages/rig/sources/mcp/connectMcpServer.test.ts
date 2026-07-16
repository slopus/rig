import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { readPackageVersion } from "../readPackageVersion.js";
import { connectMcpServer, type ConnectedMcpServer } from "./connectMcpServer.js";

const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "testing/clientIdentityMcpServer.mjs",
);

describe("connectMcpServer", () => {
    it("reports Rig's current package version to the server", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-mcp-identity-"));
        const identityPath = join(root, "client-identity.json");
        let connection: ConnectedMcpServer | undefined;
        try {
            connection = await connectMcpServer(
                "identity",
                {
                    args: [fixture, identityPath],
                    command: process.execPath,
                    transport: "stdio",
                },
                root,
                root,
            );

            await vi.waitFor(
                async () => {
                    await expect(readFile(identityPath, "utf8")).resolves.toBe(
                        JSON.stringify({ name: "rig", version: readPackageVersion() }),
                    );
                },
                { timeout: 5_000 },
            );
        } finally {
            await connection?.close();
            await rm(root, { recursive: true, force: true });
        }
    }, 10_000);
});
