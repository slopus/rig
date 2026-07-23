import type { ProviderQuota, ProviderQuotaWindow } from "@/core/ProviderQuota.js";
import { unavailableProviderQuota } from "@/core/unavailableProviderQuota.js";
import { CodexSessionCredential } from "@/vendors/codex/CodexSessionCredential.js";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_CODEX_QUOTA_TIMEOUT_MS = 5_000;

export interface FetchCodexProviderQuotaOptions {
    authPath?: string;
    baseUrl?: string;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
}

export async function fetchCodexProviderQuota(
    options: FetchCodexProviderQuotaOptions = {},
): Promise<ProviderQuota> {
    const now = options.now ?? Date.now;
    const unavailable = (): ProviderQuota => unavailableProviderQuota("codex", now());

    try {
        const credential = await CodexSessionCredential.tryLoad({
            ...(options.authPath === undefined ? {} : { authFile: options.authPath }),
            ...(options.env === undefined ? {} : { env: options.env }),
        });
        if (credential === null) return unavailable();

        const headers = new Headers({
            authorization: `Bearer ${credential.credential.accessToken}`,
        });
        if (credential.credential.accountId !== undefined) {
            headers.set("chatgpt-account-id", credential.credential.accountId);
        }

        const baseUrl = (options.baseUrl ?? DEFAULT_CODEX_BASE_URL).replace(/\/+$/u, "");
        const response = await (options.fetch ?? fetch)(`${baseUrl}/wham/usage`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_CODEX_QUOTA_TIMEOUT_MS),
        });
        if (!response.ok) return unavailable();

        const body = (await response.json()) as {
            rate_limit?: {
                primary_window?: CodexQuotaWindowPayload | null;
                secondary_window?: CodexQuotaWindowPayload | null;
            } | null;
        };
        const capturedAt = now();
        return {
            capturedAt,
            source: "codex",
            windows: parseCodexQuotaWindows(
                [body.rate_limit?.primary_window, body.rate_limit?.secondary_window],
                capturedAt,
            ),
        };
    } catch {
        return unavailable();
    }
}

interface CodexQuotaWindowPayload {
    limit_window_seconds?: unknown;
    reset_at?: unknown;
    used_percent?: unknown;
}

function parseCodexQuotaWindows(
    payloads: readonly (CodexQuotaWindowPayload | null | undefined)[],
    capturedAt: number,
): ProviderQuota["windows"] {
    const windows: ProviderQuota["windows"] = {
        fiveHour: { status: "unavailable" },
        weekly: { status: "unavailable" },
    };
    for (const payload of payloads) {
        if (payload == null) continue;
        const durationSeconds = payload.limit_window_seconds;
        if (
            typeof durationSeconds !== "number" ||
            !Number.isSafeInteger(durationSeconds) ||
            durationSeconds <= 0
        ) {
            continue;
        }
        const key = durationMatches(durationSeconds, 5 * 60 * 60)
            ? "fiveHour"
            : durationMatches(durationSeconds, 7 * 24 * 60 * 60)
              ? "weekly"
              : undefined;
        if (key !== undefined) {
            windows[key] = parseCodexQuotaWindow(payload, durationSeconds, capturedAt);
        }
    }
    return windows;
}

function parseCodexQuotaWindow(
    payload: CodexQuotaWindowPayload,
    durationSeconds: number,
    capturedAt: number,
): ProviderQuotaWindow {
    const usedPercent = payload.used_percent;
    const resetAtSeconds = payload.reset_at;
    if (
        typeof usedPercent !== "number" ||
        !Number.isFinite(usedPercent) ||
        usedPercent < 0 ||
        usedPercent > 100 ||
        typeof resetAtSeconds !== "number" ||
        !Number.isSafeInteger(resetAtSeconds) ||
        resetAtSeconds < 0
    ) {
        return { status: "unavailable" };
    }
    return {
        capturedAt,
        status: "available",
        usedPercent,
        resetsAt: resetAtSeconds * 1_000,
        durationMs: durationSeconds * 1_000,
    };
}

function durationMatches(actualSeconds: number, expectedSeconds: number): boolean {
    return Math.abs(actualSeconds - expectedSeconds) <= expectedSeconds * 0.05;
}
