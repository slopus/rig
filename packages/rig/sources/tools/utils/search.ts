import { join, relative, sep } from "node:path";

import type { AgentContext } from "../../agent/context/AgentContext.js";
import { resolveFileSystemPath } from "../../agent/context/resolveFileSystemPath.js";
import { runCommand } from "./shell.js";

export interface GrepOptions {
    pattern: string;
    path?: string;
    glob?: string;
    outputMode?: "content" | "files_with_matches" | "count";
    before?: number;
    after?: number;
    context?: number;
    lineNumbers?: boolean;
    ignoreCase?: boolean;
    literal?: boolean;
    type?: string;
    headLimit?: number;
    offset?: number;
    multiline?: boolean;
    cwd?: string;
    signal?: AbortSignal;
}

export interface GrepResult {
    text: string;
    matches: number;
    truncated: boolean;
}

export async function runRipgrep(options: GrepOptions, context: AgentContext): Promise<GrepResult> {
    const cwd = options.cwd ?? context.bash.cwd;
    const target = options.path ? resolveFileSystemPath(options.path, cwd, context.fs.home) : cwd;
    const args: string[] = [];
    const outputMode = options.outputMode ?? "files_with_matches";
    if (outputMode === "files_with_matches") {
        args.push("--files-with-matches");
    } else if (outputMode === "count") {
        args.push("--count");
    } else if (options.lineNumbers !== false) {
        args.push("--line-number");
    }

    if (options.ignoreCase) args.push("--ignore-case");
    if (options.literal) args.push("--fixed-strings");
    if (options.glob) args.push("--glob", options.glob);
    if (options.type) args.push("--type", options.type);
    if (options.multiline) args.push("--multiline", "--multiline-dotall");
    if (options.context !== undefined) args.push("--context", String(options.context));
    if (options.before !== undefined) args.push("--before-context", String(options.before));
    if (options.after !== undefined) args.push("--after-context", String(options.after));
    args.push("--regexp", options.pattern, target);

    const commandOptions: Parameters<typeof runCommand>[0] = {
        command: "rg",
        args,
        cwd,
        timeoutMs: 30_000,
        maxOutputBytes: 512_000,
    };
    if (options.signal !== undefined) {
        commandOptions.signal = options.signal;
    }

    const command = await runCommand(commandOptions, context);

    if (command.exitCode !== 0 && command.exitCode !== 1) {
        throw new Error(command.stderr || command.stdout || `rg exited ${command.exitCode}`);
    }

    const lines = command.stdout.length === 0 ? [] : command.stdout.replace(/\n$/, "").split("\n");
    const offset = Math.max(0, options.offset ?? 0);
    const headLimit = options.headLimit ?? 250;
    const limited = headLimit === 0 ? lines.slice(offset) : lines.slice(offset, offset + headLimit);
    const truncated = headLimit !== 0 && offset + limited.length < lines.length;

    return {
        text: limited.join("\n"),
        matches: lines.length,
        truncated,
    };
}

export interface GlobOptions {
    pattern: string;
    path?: string;
    cwd?: string;
    limit?: number;
    signal?: AbortSignal;
}

export async function globFiles(
    options: GlobOptions,
    context: AgentContext,
): Promise<readonly string[]> {
    const cwd = options.cwd ?? context.fs.cwd;
    const root = options.path ? resolveFileSystemPath(options.path, cwd, context.fs.home) : cwd;
    const regex = globToRegExp(options.pattern);
    const files: { path: string; mtimeMs: number }[] = [];
    await walkFiles(root, context, options.signal, async (filePath, mtimeMs) => {
        const rel = relative(root, filePath).split(sep).join("/");
        if (regex.test(rel) || regex.test(filePath.split(sep).join("/"))) {
            files.push({ path: filePath, mtimeMs });
        }
    });
    files.sort(
        (left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path),
    );
    return files.slice(0, options.limit ?? 100).map((file) => file.path);
}

async function walkFiles(
    root: string,
    context: AgentContext,
    signal: AbortSignal | undefined,
    onFile: (path: string, mtimeMs: number) => Promise<void> | void,
): Promise<void> {
    const directories = [root];
    while (directories.length > 0) {
        if (signal?.aborted) {
            throw new Error("Search aborted.");
        }
        const directory = directories.pop();
        if (directory === undefined) break;
        let entries: readonly string[];
        try {
            entries = await context.fs.readdir(directory);
        } catch (error) {
            if (directory === root) throw error;
            continue;
        }

        for (const name of entries) {
            if (signal?.aborted) {
                throw new Error("Search aborted.");
            }
            if (name === ".git" || name === "node_modules") continue;

            const full = join(directory, name);
            let stats;
            try {
                stats = await context.fs.lstat(full);
            } catch {
                continue;
            }
            if (stats.isSymbolicLink) continue;
            if (stats.isDirectory) {
                directories.push(full);
            } else if (stats.isFile) {
                await onFile(full, stats.mtimeMs);
            }
        }
    }
}

function globToRegExp(pattern: string): RegExp {
    let source = "";
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        const next = pattern[i + 1];
        if (char === "*" && next === "*") {
            if (pattern[i + 2] === "/") {
                source += "(?:.*/)?";
                i += 2;
            } else {
                source += ".*";
                i++;
            }
        } else if (char === "*") {
            source += "[^/]*";
        } else if (char === "?") {
            source += "[^/]";
        } else if (char === "{") {
            const end = pattern.indexOf("}", i);
            if (end !== -1) {
                source += `(${pattern
                    .slice(i + 1, end)
                    .split(",")
                    .map(escapeRegExp)
                    .join("|")})`;
                i = end;
            } else {
                source += "\\{";
            }
        } else {
            source += escapeRegExp(char ?? "");
        }
    }
    return new RegExp(`^${source}$`);
}

function escapeRegExp(value: string): string {
    return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
