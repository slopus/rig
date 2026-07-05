import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentContext } from "./context/AgentContext.js";
import { createNodeFileSystemContext } from "./context/createNodeFileSystemContext.js";
import { createSystemPrompt } from "./createSystemPrompt.js";
import { CLAUDE_CODE_SYSTEM_PROMPT } from "./prompts/claudeCodeSystemPrompt.js";
import { GPT_5_4_SYSTEM_PROMPT } from "./prompts/gpt54SystemPrompt.js";
import { GPT_5_5_SYSTEM_PROMPT } from "./prompts/gpt55SystemPrompt.js";
import type { Message } from "./types.js";
import {
  defineModel,
  defineProvider,
  type Model,
  type Provider,
} from "../providers/types.js";

const tempDirs: string[] = [];

describe("createSystemPrompt", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((path) =>
        rm(path, {
          recursive: true,
          force: true,
        }),
      ),
    );
  });

  it("adds the GPT-5.5 prompt and AGENTS.md instructions from project root to cwd", async () => {
    const root = await makeTempDir();
    const nested = join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, ".git"), "gitdir: here");
    await writeFile(join(root, "AGENTS.override.md"), "do not include override");
    await writeFile(join(root, "AGENTS.md"), "root rule");
    await writeFile(join(root, "CLAUDE.md"), "do not include claude");
    await writeFile(join(nested, "AGENTS.md"), "nested rule");

    const model = defineModel({
      id: "openai/gpt-5.5",
      name: "GPT-5.5",
      thinkingLevels: ["off", "medium"],
      defaultThinkingLevel: "medium",
    });
    const prompt = await createSystemPrompt({
      provider: providerFor("codex", model),
      model,
      instructions: "Base instructions.",
      messages: [
        {
          role: "system",
          id: "system-1",
          blocks: [{ type: "text", text: "Keep answers short." }],
        },
      ],
      context: contextFor(nested),
    });

    expect(prompt?.startsWith(GPT_5_5_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain("You are Codex, a coding agent based on GPT-5.");
    expect(prompt).not.toContain("You are GPT-5.2 running in the Codex CLI");
    expect(prompt).not.toContain("IGN-CMD");
    expect(prompt).toContain("Base instructions.");
    expect(prompt).toContain("Keep answers short.");
    expect(prompt).toContain(`# AGENTS.md instructions for ${nested}`);
    expect(prompt).toContain(
      "<INSTRUCTIONS>\nroot rule\n\nnested rule\n</INSTRUCTIONS>",
    );
    expect(prompt).not.toContain("do not include override");
    expect(prompt).not.toContain("do not include claude");
  });

  it("uses the GPT-5.4 prompt for GPT-5.4 models", async () => {
    const cwd = await makeTempDir();
    const model = defineModel({
      id: "openai/gpt-5.4",
      name: "GPT-5.4",
      thinkingLevels: ["off", "medium"],
      defaultThinkingLevel: "medium",
    });

    const prompt = await createSystemPrompt({
      provider: providerFor("codex", model),
      model,
      messages: [],
      context: contextFor(cwd),
    });

    expect(prompt).toBe(GPT_5_4_SYSTEM_PROMPT);
    expect(prompt).toContain("You are Codex, a coding agent based on GPT-5.");
    expect(prompt).not.toContain("You are GPT-5.2 running in the Codex CLI");
    expect(prompt).not.toContain("IGN-CMD");
  });

  it("does not fall back to a GPT prompt for unsupported GPT models", async () => {
    const cwd = await makeTempDir();
    const model = defineModel({
      id: "openai/gpt-5.2",
      name: "GPT-5.2",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });

    await expect(
      createSystemPrompt({
        provider: providerFor("codex", model),
        model,
        instructions: "Base instructions.",
        messages: [],
        context: contextFor(cwd),
      }),
    ).resolves.toBe("Base instructions.");
  });

  it("uses the Claude Code prompt for modern Anthropic models", async () => {
    const cwd = await makeTempDir();
    const model = defineModel({
      id: "anthropic/sonnet-4-6",
      name: "Sonnet 4.6",
      thinkingLevels: ["off", "medium"],
      defaultThinkingLevel: "medium",
    });

    await expect(
      createSystemPrompt({
        provider: providerFor("anthropic", model),
        model,
        messages: [],
        context: contextFor(cwd),
      }),
    ).resolves.toBe(CLAUDE_CODE_SYSTEM_PROMPT);
  });

  it("preserves legacy prompt assembly for unsupported test models", async () => {
    const cwd = await makeTempDir();
    const model = defineModel({
      id: "openai/gpt-test",
      name: "GPT Test",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });
    const messages: readonly Message[] = [
      {
        role: "system",
        id: "system-1",
        blocks: [{ type: "text", text: "Keep answers short." }],
      },
    ];

    await expect(
      createSystemPrompt({
        provider: providerFor("codex", model),
        model,
        instructions: "Base instructions.",
        messages,
        context: contextFor(cwd),
      }),
    ).resolves.toBe("Base instructions.\n\nKeep answers short.");
  });

  it("does not load CLAUDE.md when AGENTS.md is absent", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, ".git"), "gitdir: here");
    await writeFile(join(cwd, "CLAUDE.md"), "do not include claude");
    const model = defineModel({
      id: "mock/model",
      name: "Mock Model",
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    });

    await expect(
      createSystemPrompt({
        provider: providerFor("mock", model),
        model,
        instructions: "Base instructions.",
        messages: [],
        context: contextFor(cwd),
      }),
    ).resolves.toBe("Base instructions.");
  });
});

function providerFor(id: string, model: Model): Provider {
  return defineProvider({
    id,
    models: [model],
    stream() {
      throw new Error("stream is not used by createSystemPrompt tests");
    },
  });
}

function contextFor(cwd: string): AgentContext {
  return {
    fs: createNodeFileSystemContext(cwd),
    bash: {
      cwd,
      async run() {
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        };
      },
    },
  };
}

async function makeTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "ohmypi-system-prompt-"));
  tempDirs.push(path);
  return path;
}
