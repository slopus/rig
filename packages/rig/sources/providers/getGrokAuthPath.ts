import { homedir } from "node:os";
import { join } from "node:path";

export function getGrokAuthPath(options: { authFile?: string; env?: NodeJS.ProcessEnv }): string {
    if (options.authFile?.trim()) return options.authFile;

    const grokHome = options.env?.GROK_HOME?.trim();
    return join(grokHome || homedir(), grokHome ? "auth.json" : ".grok/auth.json");
}
