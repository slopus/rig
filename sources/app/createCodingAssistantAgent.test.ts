import { describe, expect, it } from "vitest";

import { NativeProxessManager } from "../processes/index.js";
import { modelOpenaiGpt55 } from "../providers/models.js";
import { createCodingAssistantAgent } from "./createCodingAssistantAgent.js";

describe("createCodingAssistantAgent", () => {
  it("creates a Codex agent with node filesystem and bash contexts", () => {
    const cwd = "/tmp/ohmypi-app-test";
    const processManager = new NativeProxessManager();

    const runtime = createCodingAssistantAgent({
      cwd,
      effort: "medium",
      processManager,
    });

    expect(runtime.cwd).toBe(cwd);
    expect(runtime.processManager).toBe(processManager);
    expect(runtime.provider.id).toBe("codex");
    expect(runtime.agent.model.id).toBe(modelOpenaiGpt55.id);
    expect(runtime.context.fs.cwd).toBe(cwd);
    expect(runtime.context.bash.cwd).toBe(cwd);
    expect(runtime.agent.snapshot().instructions).toContain(cwd);
    expect(runtime.agent.snapshot().effort).toBe("medium");
  });
});
