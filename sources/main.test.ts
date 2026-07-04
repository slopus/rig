import { describe, expect, it } from "vitest";

import { isMainModule } from "./app/isMainModule.js";
import { main } from "./main.js";

describe("main entry point", () => {
  it("exports the app main function without starting the TUI on import", () => {
    expect(main).toBeTypeOf("function");
  });

  it("detects direct module execution", () => {
    const file = "/tmp/ohmypi/dist/main.js";
    expect(isMainModule(`file://${file}`, ["node", file])).toBe(true);
    expect(isMainModule("file:///tmp/other.js", ["node", file])).toBe(false);
  });
});
