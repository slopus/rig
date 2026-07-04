import { runApp, type RunAppOptions } from "./runApp.js";

export async function main(): Promise<void> {
  const options: RunAppOptions = {
    cwd: process.cwd(),
  };

  if (process.env.OPENAI_API_KEY !== undefined) {
    options.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.OHMYPI_EFFORT !== undefined) {
    options.effort = process.env.OHMYPI_EFFORT;
  }
  if (process.env.OHMYPI_MODEL !== undefined) {
    options.modelId = process.env.OHMYPI_MODEL;
  }

  await runApp(options);
}
