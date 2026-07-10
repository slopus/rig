import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ClaudeCodeCredentials {
    claudeAiOauth?: {
        accessToken?: string;
    };
}

export async function readClaudeCodeOAuthToken(
    env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
    if (env.CLAUDE_CODE_OAUTH_TOKEN) {
        return env.CLAUDE_CODE_OAUTH_TOKEN;
    }

    const configDirectory = env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

    if (process.platform === "darwin") {
        const token = await readTokenFromMacOsKeychain(configDirectory, env);
        if (token !== undefined) {
            return token;
        }
    }

    try {
        return parseAccessToken(await readFile(join(configDirectory, ".credentials.json"), "utf8"));
    } catch {
        return undefined;
    }
}

async function readTokenFromMacOsKeychain(
    configDirectory: string,
    env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
    const defaultDirectory = env.CLAUDE_CONFIG_DIR === undefined;
    const directorySuffix = defaultDirectory
        ? ""
        : `-${createHash("sha256").update(configDirectory).digest("hex").slice(0, 8)}`;
    const oauthSuffix = env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? "-custom-oauth" : "";
    const service = `Claude Code${oauthSuffix}-credentials${directorySuffix}`;
    const account = env.USER ?? userInfo().username;

    try {
        const { stdout } = await execFileAsync(
            "security",
            ["find-generic-password", "-a", account, "-w", "-s", service],
            { encoding: "utf8" },
        );
        return parseAccessToken(stdout);
    } catch {
        return undefined;
    }
}

function parseAccessToken(value: string): string | undefined {
    try {
        const credentials = JSON.parse(value) as ClaudeCodeCredentials;
        const token = credentials.claudeAiOauth?.accessToken;
        return typeof token === "string" && token.length > 0 ? token : undefined;
    } catch {
        return undefined;
    }
}
