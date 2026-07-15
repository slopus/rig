import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ProviderQuota } from "./providerQuota.js";
import { readCodexQuotaAuth } from "./readCodexQuotaAuth.js";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_CODEX_QUOTA_TIMEOUT_MS = 5_000;

export interface FetchCodexProviderQuotaOptions {
    authPath?: string;
    baseUrl?: string;
    fetch?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
}

export async function fetchCodexProviderQuota(
    options: FetchCodexProviderQuotaOptions = {},
): Promise<ProviderQuota> {
    const now = options.now ?? Date.now;
    const unavailable = (): ProviderQuota => ({
        status: "unavailable",
        source: "codex",
        window: "five_hour",
        capturedAt: now(),
    });

    try {
        const authFile = options.authPath ?? path.join(homedir(), ".codex", "auth.json");
        const auth = readCodexQuotaAuth(await readFile(authFile, "utf8"));
        if (auth === undefined) {
            return unavailable();
        }

        const headers = new Headers({ authorization: `Bearer ${auth.accessToken}` });
        if (auth.accountId !== undefined) {
            headers.set("chatgpt-account-id", auth.accountId);
        }

        const baseUrl = (options.baseUrl ?? DEFAULT_CODEX_BASE_URL).replace(/\/+$/, "");
        const response = await (options.fetch ?? fetch)(`${baseUrl}/wham/usage`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_CODEX_QUOTA_TIMEOUT_MS),
        });
        if (!response.ok) {
            return unavailable();
        }

        const body = (await response.json()) as {
            rate_limit?: {
                primary_window?: {
                    used_percent?: unknown;
                    reset_at?: unknown;
                } | null;
            } | null;
        };
        const primaryWindow = body.rate_limit?.primary_window;
        const usedPercent = primaryWindow?.used_percent;
        const resetAtSeconds = primaryWindow?.reset_at;
        if (
            typeof usedPercent !== "number" ||
            !Number.isFinite(usedPercent) ||
            usedPercent < 0 ||
            usedPercent > 100 ||
            typeof resetAtSeconds !== "number" ||
            !Number.isSafeInteger(resetAtSeconds) ||
            resetAtSeconds < 0
        ) {
            return unavailable();
        }

        return {
            status: "available",
            source: "codex",
            window: "five_hour",
            usedPercent,
            resetsAt: resetAtSeconds * 1_000,
            capturedAt: now(),
        };
    } catch {
        return unavailable();
    }
}
