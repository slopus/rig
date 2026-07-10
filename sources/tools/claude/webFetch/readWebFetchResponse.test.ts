import { describe, expect, it } from "vitest";

import { readWebFetchResponse } from "./readWebFetchResponse.js";

describe("readWebFetchResponse", () => {
    it("rejects responses larger than ten megabytes", async () => {
        const response = new Response("small body", {
            headers: { "content-length": String(10 * 1024 * 1024 + 1) },
        });

        await expect(readWebFetchResponse(response)).rejects.toThrow("10 MB size limit");
    });
});
