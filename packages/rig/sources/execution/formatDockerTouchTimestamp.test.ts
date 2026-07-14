import { describe, expect, it } from "vitest";

import { formatDockerTouchTimestamp } from "./formatDockerTouchTimestamp.js";

describe("formatDockerTouchTimestamp", () => {
    it("formats UTC time in the POSIX touch format supported by BusyBox", () => {
        expect(formatDockerTouchTimestamp(Date.parse("2026-07-14T07:14:29.097Z"))).toBe(
            "202607140714.29",
        );
    });

    it("pads every timestamp component and discards unsupported subseconds", () => {
        expect(formatDockerTouchTimestamp(Date.parse("2001-02-03T04:05:06.999Z"))).toBe(
            "200102030405.06",
        );
    });

    it("rejects invalid timestamps", () => {
        expect(() => formatDockerTouchTimestamp(Number.NaN)).toThrow(
            "invalid Docker file modification time",
        );
    });
});
