import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";

import { CodingAssistantApp } from "./CodingAssistantApp.js";
import {
  createCodingAssistantAgent,
  type CreateCodingAssistantAgentOptions,
} from "./createCodingAssistantAgent.js";

export interface RunAppOptions {
  apiKey?: string;
  cwd?: string;
  effort?: string;
  instructions?: string;
  modelId?: string;
}

export async function runApp(options: RunAppOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const agentOptions: CreateCodingAssistantAgentOptions = { cwd };
  if (options.apiKey !== undefined) agentOptions.apiKey = options.apiKey;
  if (options.effort !== undefined) agentOptions.effort = options.effort;
  if (options.instructions !== undefined) agentOptions.instructions = options.instructions;
  if (options.modelId !== undefined) agentOptions.modelId = options.modelId;

  const runtime = createCodingAssistantAgent(agentOptions);
  const tui = new TUI(new ProcessTerminal());
  const app = new CodingAssistantApp({
    agent: runtime.agent,
    cwd: runtime.cwd,
    processManager: runtime.processManager,
    tui,
  });

  const stop = () => {
    void app.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    app.start();
    await app.waitForExit();
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await runtime.processManager.killAll({ forceAfterMs: 500 });
  }
}
