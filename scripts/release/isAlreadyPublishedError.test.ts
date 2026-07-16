import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAlreadyPublishedError } from "./isAlreadyPublishedError.js";

describe("isAlreadyPublishedError", () => {
    it("recognizes npm's already-published errors", () => {
        assert.equal(
            isAlreadyPublishedError(
                "npm error code E403: You cannot publish over the previously published versions.",
            ),
            true,
        );
        assert.equal(isAlreadyPublishedError("npm error code EPUBLISHCONFLICT"), true);
    });

    it("does not mistake an unrelated forbidden response for a published version", () => {
        assert.equal(
            isAlreadyPublishedError(
                "npm error code E403: 403 Forbidden - PUT package - You do not have permission to publish this package.",
            ),
            false,
        );
    });
});
