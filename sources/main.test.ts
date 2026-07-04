import { describe, expect, it, vi } from "vitest";

describe("main entry point", () => {
  it("prints hello world", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await import("./main.js");
      expect(log).toHaveBeenCalledWith("Hello, world!");
    } finally {
      log.mockRestore();
    }
  });
});
