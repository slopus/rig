import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCodexProviderQuota } from "./fetchCodexProviderQuota.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
});

describe("fetchCodexProviderQuota", () => {
    it("fetches the authoritative primary window with local bearer and account headers", async () => {
        const authPath = await writeAuthFile({
            access_token: "access-token",
            account_id: "account-123",
        });
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            Response.json({
                rate_limit: {
                    primary_window: {
                        used_percent: 37.5,
                        reset_at: 1_735_689_600,
                    },
                },
            }),
        );

        const quota = await fetchCodexProviderQuota({
            authPath,
            baseUrl: "https://example.test/backend-api/",
            fetch: fetchMock,
            now: () => 123_000,
        });

        expect(quota).toEqual({
            status: "available",
            source: "codex",
            window: "five_hour",
            usedPercent: 37.5,
            resetsAt: 1_735_689_600_000,
            capturedAt: 123_000,
        });
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe("https://example.test/backend-api/wham/usage");
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
        expect(new Headers(init?.headers).get("chatgpt-account-id")).toBe("account-123");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("uses a JWT account claim when auth.json has no explicit account id", async () => {
        const payload = Buffer.from(
            JSON.stringify({
                "https://api.openai.com/auth": { chatgpt_account_id: "jwt-account" },
            }),
        ).toString("base64url");
        const authPath = await writeAuthFile({
            access_token: "access-token",
            id_token: `header.${payload}.signature`,
        });
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            Response.json({
                rate_limit: { primary_window: { used_percent: 0, reset_at: 10 } },
            }),
        );

        await fetchCodexProviderQuota({ authPath, fetch: fetchMock });

        const init = fetchMock.mock.calls[0]?.[1];
        expect(new Headers(init?.headers).get("chatgpt-account-id")).toBe("jwt-account");
    });

    it.each([
        ["missing auth", undefined],
        ["malformed response", { rate_limit: { primary_window: { used_percent: 20 } } }],
    ])("returns unavailable for %s without estimating", async (_name, body) => {
        const authPath =
            body === undefined
                ? path.join(tmpdir(), `missing-codex-auth-${crypto.randomUUID()}.json`)
                : await writeAuthFile({ access_token: "token" });
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body ?? {}));

        await expect(
            fetchCodexProviderQuota({ authPath, fetch: fetchMock, now: () => 55 }),
        ).resolves.toEqual({
            status: "unavailable",
            source: "codex",
            window: "five_hour",
            capturedAt: 55,
        });
    });

    it("aborts a request at the configured timeout and returns unavailable", async () => {
        const authPath = await writeAuthFile({ access_token: "token" });
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(
            async (_url, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
                        once: true,
                    });
                }),
        );

        await expect(
            fetchCodexProviderQuota({ authPath, fetch: fetchMock, timeoutMs: 1, now: () => 77 }),
        ).resolves.toEqual({
            status: "unavailable",
            source: "codex",
            window: "five_hour",
            capturedAt: 77,
        });
    });
});

async function writeAuthFile(tokens: Record<string, string>): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "rig-codex-quota-"));
    temporaryDirectories.push(directory);
    const authPath = path.join(directory, "auth.json");
    await writeFile(authPath, JSON.stringify({ tokens }));
    return authPath;
}
