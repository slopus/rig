import { checkWebFetchDomain } from "./checkWebFetchDomain.js";
import { getTurndownService } from "./getTurndownService.js";
import { getWithPermittedRedirects } from "./getWithPermittedRedirects.js";
import { isBinaryContentType } from "./isBinaryContentType.js";
import { persistWebFetchBinary } from "./persistWebFetchBinary.js";
import type { WebFetchContent, WebFetchResponse } from "./types.js";
import { validateWebFetchUrl } from "./validateWebFetchUrl.js";
import { webFetchUrlCache } from "./cache.js";

export async function getUrlMarkdownContent(
    url: string,
    signal?: AbortSignal,
): Promise<WebFetchResponse> {
    if (!validateWebFetchUrl(url)) {
        throw new Error(`Invalid URL: ${url}`);
    }

    const cached = webFetchUrlCache.get(url);
    if (cached !== undefined) {
        return { ...cached };
    }

    const parsed = new URL(url);
    if (parsed.protocol === "http:") {
        parsed.protocol = "https:";
    }
    await checkWebFetchDomain(parsed.hostname, signal);

    const response = await getWithPermittedRedirects(parsed.toString(), signal);
    if ("type" in response) {
        return response;
    }

    const { raw } = response;
    const contentType = response.response.headers.get("content-type") ?? "";
    const persistedPath = isBinaryContentType(contentType)
        ? await persistWebFetchBinary(raw, contentType)
        : undefined;
    const decoded = raw.toString("utf8");
    const content = contentType.includes("text/html")
        ? (await getTurndownService()).turndown(decoded)
        : decoded;

    const result: WebFetchContent = {
        bytes: raw.byteLength,
        code: response.response.status,
        codeText: response.response.statusText,
        content,
        contentType,
        ...(persistedPath !== undefined ? { persistedPath, persistedSize: raw.byteLength } : {}),
    };
    webFetchUrlCache.set(url, result, {
        size: Math.max(1, Buffer.byteLength(content)),
    });
    return result;
}
