import { createTimedSignal } from "./createTimedSignal.js";
import { isPermittedWebFetchRedirect } from "./isPermittedWebFetchRedirect.js";
import { readWebFetchResponse } from "./readWebFetchResponse.js";
import type { WebFetchRedirect } from "./types.js";

const FETCH_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 10;
const REDIRECT_CODES = new Set([301, 302, 307, 308]);

export interface WebFetchHttpResponse {
    response: Response;
    raw: Buffer;
}

export async function getWithPermittedRedirects(
    url: string,
    signal?: AbortSignal,
    depth = 0,
): Promise<WebFetchHttpResponse | WebFetchRedirect> {
    if (depth > MAX_REDIRECTS) {
        throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`);
    }

    const timedSignal = createTimedSignal(signal, FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            headers: {
                Accept: "text/markdown, text/html, */*",
                "User-Agent": "Claude-User (rig; +https://support.anthropic.com/)",
            },
            redirect: "manual",
            signal: timedSignal.signal,
        });

        if (REDIRECT_CODES.has(response.status)) {
            const location = response.headers.get("location");
            if (location === null) {
                throw new Error("Redirect response is missing a Location header");
            }
            const redirectUrl = new URL(location, url).toString();
            if (isPermittedWebFetchRedirect(url, redirectUrl)) {
                return getWithPermittedRedirects(redirectUrl, signal, depth + 1);
            }
            return {
                type: "redirect",
                originalUrl: url,
                redirectUrl,
                statusCode: response.status,
            };
        }

        if (!response.ok) {
            if (
                response.status === 403 &&
                response.headers.get("x-proxy-error") === "blocked-by-allowlist"
            ) {
                const domain = new URL(url).hostname;
                throw new Error(`Access to ${domain} is blocked by the network egress proxy.`);
            }
            throw new Error(`Web request failed with ${response.status} ${response.statusText}`);
        }

        return { response, raw: await readWebFetchResponse(response) };
    } finally {
        timedSignal.dispose();
    }
}
