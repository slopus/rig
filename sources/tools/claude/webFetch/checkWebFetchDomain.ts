import { webFetchDomainCache } from "./cache.js";
import { createTimedSignal } from "./createTimedSignal.js";

const DOMAIN_CHECK_TIMEOUT_MS = 10_000;

export async function checkWebFetchDomain(domain: string, signal?: AbortSignal): Promise<void> {
    if (webFetchDomainCache.has(domain)) {
        return;
    }

    const timedSignal = createTimedSignal(signal, DOMAIN_CHECK_TIMEOUT_MS);
    try {
        const response = await fetch(
            `https://api.anthropic.com/api/web/domain_info?domain=${encodeURIComponent(domain)}`,
            { signal: timedSignal.signal },
        );
        if (!response.ok) {
            throw new Error(`Domain check returned ${response.status} ${response.statusText}`);
        }

        const body = (await response.json()) as { can_fetch?: unknown };
        if (body.can_fetch !== true) {
            throw new Error(`Rig is unable to fetch from ${domain}`);
        }
        webFetchDomainCache.set(domain, true);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("Rig is unable")) {
            throw error;
        }
        throw new Error(
            `Unable to verify whether ${domain} is safe to fetch. The Anthropic domain check may be blocked by the network.`,
            { cause: error },
        );
    } finally {
        timedSignal.dispose();
    }
}
