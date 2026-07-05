import { describe, expect, it } from "vitest";

import { renderActivityWave } from "./renderActivityWave.js";

describe("renderActivityWave", () => {
  it("renders readable text with a moving grayscale highlight", () => {
    const firstFrame = renderActivityWave("Working", 0);
    const secondFrame = renderActivityWave("Working", 1);

    expect(stripAnsi(firstFrame)).toBe("Working");
    expect(stripAnsi(secondFrame)).toBe("Working");
    expect(firstFrame).not.toBe(secondFrame);
    expect(firstFrame).toContain("\x1b[38;5;255m");
    expect(firstFrame).toContain("\x1b[38;5;244m");
  });
});

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
