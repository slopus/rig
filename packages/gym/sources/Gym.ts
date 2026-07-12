import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import type { IPty } from "@lydell/node-pty";

import { GhosttyTerminal } from "./GhosttyTerminal.js";
import { GymTerminal } from "./GymTerminal.js";
import { MockInferenceServer } from "./MockInferenceServer.js";
import { resolveWorkspacePath } from "./resolveWorkspacePath.js";

const execFileAsync = promisify(execFile);

export class Gym {
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
        inference: MockInferenceServer;
        pty: IPty;
        workspacePath: string;
    }) {
        this.#containerName = options.containerName;
        this.#ghostty = options.ghostty;
        this.#homePath = options.homePath;
        this.#pty = options.pty;
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
        await this.inference.stop();
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
}
