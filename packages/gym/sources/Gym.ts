import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import type { IPty } from "@lydell/node-pty";

import { GhosttyTerminal } from "./GhosttyTerminal.js";
import { GymTerminal } from "./GymTerminal.js";
import type { InterceptingHttpProxy } from "./InterceptingHttpProxy.js";
import { MockInferenceServer } from "./MockInferenceServer.js";
import { resolveWorkspacePath } from "./resolveWorkspacePath.js";

const execFileAsync = promisify(execFile);

export class Gym {
    readonly httpProxy: InterceptingHttpProxy | undefined;
    readonly inference: MockInferenceServer;
    readonly terminal: GymTerminal;
    readonly workspacePath: string;

    #containerName: string;
    #disposed = false;
    #exit: Promise<{ exitCode: number; signal?: number }>;
    #ghostty: GhosttyTerminal;
    #homePath: string | undefined;
    #pty: IPty;

    constructor(options: {
        containerName: string;
        ghostty: GhosttyTerminal;
        homePath?: string;
        httpProxy?: InterceptingHttpProxy;
        inference: MockInferenceServer;
        pty: IPty;
        workspacePath: string;
    }) {
        this.#containerName = options.containerName;
        this.#ghostty = options.ghostty;
        this.#homePath = options.homePath;
        this.#pty = options.pty;
        this.httpProxy = options.httpProxy;
        this.inference = options.inference;
        this.terminal = new GymTerminal(options.pty, options.ghostty);
        this.workspacePath = options.workspacePath;
        this.#exit = new Promise((resolve) => {
            options.pty.onExit(resolve);
        });
    }

    async dispose(): Promise<void> {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#pty.kill();
        await execFileAsync("docker", ["rm", "--force", this.#containerName]).catch(() => {});
        this.#ghostty.close();
        await Promise.all([this.inference.stop(), this.httpProxy?.stop()]);
        await Promise.all([
            ...(this.#homePath === undefined
                ? []
                : [rm(this.#homePath, { force: true, recursive: true })]),
            rm(this.workspacePath, { force: true, recursive: true }),
        ]);
    }

    exit(): Promise<{ exitCode: number; signal?: number }> {
        return this.#exit;
    }

    readFile(path: string): Promise<string> {
        return readFile(resolveWorkspacePath(this.workspacePath, path), "utf8");
    }

    async runInContainer(
        command: string,
        args: readonly string[] = [],
        options: { timeoutMs?: number } = {},
    ): Promise<{ stderr: string; stdout: string }> {
        if (this.#disposed) throw new Error("Cannot run a command in a disposed Gym.");
        const { stderr, stdout } = await execFileAsync(
            "docker",
            ["exec", "--workdir", "/workspace", this.#containerName, command, ...args],
            {
                maxBuffer: 10 * 1024 * 1024,
                timeout: options.timeoutMs ?? 30_000,
            },
        );
        return { stderr, stdout };
    }
}
