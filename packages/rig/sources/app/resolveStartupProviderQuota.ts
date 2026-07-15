import type { GetCurrentProviderQuotaResponse } from "../protocol/index.js";

export const STARTUP_PROVIDER_QUOTA_BUDGET_MS = 200;

export async function resolveStartupProviderQuota(
    load: () => Promise<GetCurrentProviderQuotaResponse>,
    budgetMs = STARTUP_PROVIDER_QUOTA_BUDGET_MS,
): Promise<GetCurrentProviderQuotaResponse | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unavailable = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), Math.max(0, budgetMs));
        timer.unref?.();
    });
    const loading = load().catch(() => undefined);
    return Promise.race([loading, unavailable]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
    });
}
