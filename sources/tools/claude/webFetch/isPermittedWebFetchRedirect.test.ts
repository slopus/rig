import { describe, expect, it } from "vitest";

import { isPermittedWebFetchRedirect } from "./isPermittedWebFetchRedirect.js";

describe("isPermittedWebFetchRedirect", () => {
    it("allows same-host and www redirects", () => {
        expect(
            isPermittedWebFetchRedirect("https://example.com/start", "https://www.example.com/end"),
        ).toBe(true);
        expect(
            isPermittedWebFetchRedirect("https://www.example.com/start", "https://example.com/end"),
        ).toBe(true);
    });

    it("rejects host, protocol, port, and credential changes", () => {
        expect(isPermittedWebFetchRedirect("https://example.com", "https://example.org")).toBe(
            false,
        );
        expect(isPermittedWebFetchRedirect("https://example.com", "http://example.com")).toBe(
            false,
        );
        expect(isPermittedWebFetchRedirect("https://example.com", "https://example.com:444")).toBe(
            false,
        );
        expect(
            isPermittedWebFetchRedirect("https://example.com", "https://user:secret@example.com"),
        ).toBe(false);
    });
});
