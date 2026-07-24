import { describe, expect, it, vi } from "vitest";

import type { ProtocolHttpClient } from "./ProtocolHttpClient.js";

const mocks = vi.hoisted(() => ({
    waitForSocketRemoval: vi.fn(),
}));

vi.mock("./waitForSocketRemoval.js", () => ({
    waitForSocketRemoval: mocks.waitForSocketRemoval,
}));

import { stopLocalProtocolServer } from "./stopLocalProtocolServer.js";

describe("stopLocalProtocolServer", () => {
    it("waits thirty seconds for the old daemon to release its socket", async () => {
        mocks.waitForSocketRemoval.mockResolvedValue(true);
        const client = {
            shutdown: vi.fn().mockResolvedValue({
                pid: process.pid,
                shuttingDown: true,
            }),
            socketPath: "/tmp/rig/server.sock",
        } as unknown as ProtocolHttpClient;

        await expect(stopLocalProtocolServer(client)).resolves.toBeUndefined();

        expect(mocks.waitForSocketRemoval).toHaveBeenCalledWith("/tmp/rig/server.sock", 30_000);
    });
});
