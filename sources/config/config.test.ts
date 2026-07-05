import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createConfigFile } from "./createConfigFile.js";
import { loadConfig } from "./loadConfig.js";
import { parseConfigToml } from "./parseConfigToml.js";
import { writeRuntimeConfigDefaults } from "./writeRuntimeConfigDefaults.js";

describe("config", () => {
  it("parses supported defaults with a TOML parser", () => {
    expect(parseConfigToml(`
# User preference.
[defaults]
model = "openai/gpt-5.4" # keep this comment
effort = 'high'
instructions = "Be direct."
`)).toEqual({
      defaults: {
        modelId: "openai/gpt-5.4",
        effort: "high",
        instructions: "Be direct.",
      },
    });
  });

  it("merges defaults, global config, local config, and runtime config", async () => {
    const root = await mkdtemp(join(tmpdir(), "ohmypi-config-"));
    try {
      const cwd = join(root, "repo");
      const configHome = join(root, "config-home");
      const globalPath = join(configHome, "ohmypi", "config.toml");
      const runtimePath = join(configHome, "ohmypi", "runtime.toml");
      const localPath = join(cwd, "ohmypi.toml");
      await mkdir(join(configHome, "ohmypi"), { recursive: true });
      await mkdir(cwd, { recursive: true });
      await writeFile(globalPath, `
[defaults]
model = "openai/gpt-5.4"
effort = "low"
`, "utf8");
      await writeFile(localPath, `
[defaults]
effort = "high"
`, "utf8");
      await writeFile(runtimePath, `
[defaults]
model = "openai/gpt-5.5"
effort = "minimal"
`, "utf8");

      const loaded = await loadConfig({
        cwd,
        env: { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv,
      });

      expect(loaded.config.defaults).toEqual({
        modelId: "openai/gpt-5.5",
        effort: "minimal",
      });
      expect(loaded.paths.global).toBe(globalPath);
      expect(loaded.paths.local).toBe(localPath);
      expect(loaded.paths.runtime).toBe(runtimePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates and updates config files", async () => {
    const root = await mkdtemp(join(tmpdir(), "ohmypi-config-"));
    try {
      const configPath = join(root, "repo", "ohmypi.toml");
      const runtimePath = join(root, "config-home", "ohmypi", "runtime.toml");

      await createConfigFile(configPath, {
        defaults: {
          modelId: "openai/gpt-5.4",
          effort: "low",
        },
      });
      await writeRuntimeConfigDefaults(runtimePath, {
        modelId: "openai/gpt-5.5",
        effort: "high",
      });

      expect(await readFile(configPath, "utf8")).toBe([
        "[defaults]",
        "model = \"openai/gpt-5.4\"",
        "effort = \"low\"",
        "",
      ].join("\n"));
      expect(await readFile(runtimePath, "utf8")).toBe([
        "[defaults]",
        "model = \"openai/gpt-5.5\"",
        "effort = \"high\"",
        "",
      ].join("\n"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
