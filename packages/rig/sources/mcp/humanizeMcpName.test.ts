import { describe, expect, it } from "vitest";

import { humanizeMcpName } from "./humanizeMcpName.js";

describe("humanizeMcpName", () => {
    it("normalizes separators, camel case, and curated product names", () => {
        expect(humanizeMcpName("openaiDeveloper_docs")).toBe("OpenAI Developer Docs");
        expect(humanizeMcpName("publishRelease")).toBe("Publish Release");
        expect(humanizeMcpName("post_hog")).toBe("PostHog");
    });

    it("preserves control characters for visible escaping at security boundaries", () => {
        expect(humanizeMcpName("publish\nrelease")).toBe("Publish\nRelease");
    });
});
