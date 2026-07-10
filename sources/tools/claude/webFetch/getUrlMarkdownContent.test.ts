import { afterEach, describe, expect, it, vi } from "vitest";

import { clearWebFetchCache } from "./cache.js";
import { getUrlMarkdownContent } from "./getUrlMarkdownContent.js";

afterEach(() => {
    clearWebFetchCache();
    vi.unstubAllGlobals();
});

describe("getUrlMarkdownContent", () => {
    it("upgrades HTTP, converts HTML to Markdown, and caches the result", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ can_fetch: true }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response("<html><body><h1>Example</h1><p>Hello world.</p></body></html>", {
                    status: 200,
                    statusText: "OK",
                    headers: { "content-type": "text/html; charset=utf-8" },
                }),
            );
        vi.stubGlobal("fetch", fetchMock);

        const first = await getUrlMarkdownContent("http://docs.example/page");
        const second = await getUrlMarkdownContent("http://docs.example/page");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://docs.example/page");
        expect(first).toMatchObject({
            bytes: 61,
            code: 200,
            codeText: "OK",
            content: "Example\n=======\n\nHello world.",
            contentType: "text/html; charset=utf-8",
        });
        expect(second).toEqual(first);
    });

    it("returns cross-host redirects without following them", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ can_fetch: true }), { status: 200 }),
            )
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 302,
                    headers: { location: "https://other.example/page" },
                }),
            );
        vi.stubGlobal("fetch", fetchMock);

        await expect(getUrlMarkdownContent("https://docs.example/page")).resolves.toEqual({
            type: "redirect",
            originalUrl: "https://docs.example/page",
            redirectUrl: "https://other.example/page",
            statusCode: 302,
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
