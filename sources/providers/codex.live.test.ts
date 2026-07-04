import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCodexProvider } from "./codex.js";
import { modelOpenaiGpt55 } from "./models.js";
import type { AssistantMessage, TextContent } from "./types.js";

const LIVE = process.env.OHMYPI_LIVE_TEST === "1";
const CODEX_AUTH_PATH = path.join(homedir(), ".codex", "auth.json");

function hasLocalCodexAuth(authPath: string = CODEX_AUTH_PATH): boolean {
  if (!existsSync(authPath)) {
    return false;
  }

  try {
    const data = JSON.parse(readFileSync(authPath, "utf8")) as {
      tokens?: { access_token?: unknown };
    };
    const token = data.tokens?.access_token;
    return typeof token === "string" && token.length > 0;
  } catch {
    return false;
  }
}

function textFromAssistantMessage(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("");
}

const describeLive = LIVE && hasLocalCodexAuth() ? describe : describe.skip;

describeLive("codex provider live", () => {
  it(
    "streams inference using local ~/.codex/auth.json authentication",
    async () => {
      const provider = createCodexProvider();
      const stream = provider.stream(modelOpenaiGpt55, {
        messages: [
          {
            role: "user",
            content: "Reply with exactly: ok",
            timestamp: Date.now(),
          },
        ],
      });

      let sawStart = false;
      let sawText = false;

      for await (const event of stream) {
        if (event.type === "start") {
          sawStart = true;
        }
        if (event.type === "text_delta" && event.delta.length > 0) {
          sawText = true;
        }
        if (event.type === "error") {
          throw new Error(event.error.errorMessage ?? "codex stream failed");
        }
      }

      const message = await stream.result();

      expect(sawStart).toBe(true);
      expect(sawText).toBe(true);
      expect(message.stopReason).not.toBe("error");
      expect(textFromAssistantMessage(message).toLowerCase()).toContain("ok");
    },
    120_000,
  );
});

describe("codex provider live prerequisites", () => {
  it("documents how to run the live test", () => {
    if (LIVE && !hasLocalCodexAuth()) {
      expect.fail(
        "OHMYPI_LIVE_TEST=1 is set but ~/.codex/auth.json is missing a usable access_token",
      );
    }

    expect(true).toBe(true);
  });
});
