import { beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "./main.js";
import { readPackageVersion } from "../readPackageVersion.js";
import { runApp } from "./runApp.js";
import { runExec } from "./runExec.js";
import { runLocalProtocolServer } from "../server/index.js";
import { runHappyAuthCommand } from "../happy/index.js";

vi.mock("./runApp.js", () => ({ runApp: vi.fn() }));
vi.mock("./runExec.js", () => ({ runExec: vi.fn() }));
vi.mock("../readPackageVersion.js", () => ({ readPackageVersion: vi.fn(() => "1.2.3") }));
vi.mock("../server/index.js", () => ({ runLocalProtocolServer: vi.fn() }));
vi.mock("../happy/index.js", () => ({ runHappyAuthCommand: vi.fn() }));

describe("main command dispatch", () => {
    beforeEach(() => {
        vi.mocked(runApp).mockReset();
        vi.mocked(runExec).mockReset();
        vi.mocked(runLocalProtocolServer).mockReset();
        vi.mocked(readPackageVersion).mockClear();
        vi.mocked(runHappyAuthCommand).mockReset();
    });

    it("starts the internal server only for its exact private invocation", async () => {
        await main(["--server"]);

        expect(runLocalProtocolServer).toHaveBeenCalledWith({
            happyIntegration: "enabled",
        });
        expect(runExec).not.toHaveBeenCalled();
        expect(runApp).not.toHaveBeenCalled();
    });

    it("treats --server after the exec separator as prompt text", async () => {
        await main(["exec", "--", "--server"]);

        expect(runExec).toHaveBeenCalledWith({
            fork: false,
            last: false,
            outputFormat: "text",
            prompt: "--server",
        });
        expect(runLocalProtocolServer).not.toHaveBeenCalled();
        expect(runApp).not.toHaveBeenCalled();
    });

    it("rejects --server as an unknown exec option", async () => {
        await expect(main(["exec", "--json", "--server"])).rejects.toThrow(
            "Unknown rig exec option '--server'.",
        );

        expect(runExec).not.toHaveBeenCalled();
        expect(runLocalProtocolServer).not.toHaveBeenCalled();
        expect(runApp).not.toHaveBeenCalled();
    });

    it("prints top-level help without starting a session", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        await main(["--help"]);

        expect(log).toHaveBeenCalledOnce();
        expect(log.mock.calls[0]?.[0]).toContain("Usage: rig");
        expect(log.mock.calls[0]?.[0]).toContain("rig exec");
        expect(runApp).not.toHaveBeenCalled();
        log.mockRestore();
    });

    it("prints the installed version without starting a session", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        await main(["--version"]);

        expect(log).toHaveBeenCalledWith("Rig 1.2.3");
        expect(readPackageVersion).toHaveBeenCalledOnce();
        expect(runApp).not.toHaveBeenCalled();
        log.mockRestore();
    });

    it("starts Happy QR authentication without opening a session", async () => {
        await main(["happy", "auth"]);

        expect(runHappyAuthCommand).toHaveBeenCalledOnce();
        expect(runApp).not.toHaveBeenCalled();
    });

    it.each(["resmue", "--unknown"])("rejects unknown top-level input %s", async (input) => {
        await expect(main([input])).rejects.toThrow(`Unknown rig`);

        expect(runApp).not.toHaveBeenCalled();
        expect(runExec).not.toHaveBeenCalled();
        expect(runLocalProtocolServer).not.toHaveBeenCalled();
    });
});
