export interface RemoteTerminalProcessExit {
    exitCode: number | null;
}

export interface RemoteTerminalProcess {
    kill(): void | Promise<void>;
    onData(listener: (data: Uint8Array) => void): () => void;
    pause(): void;
    resize(cols: number, rows: number): void | Promise<void>;
    resume(): void;
    wait(): Promise<RemoteTerminalProcessExit>;
    write(data: string | Uint8Array): boolean | Promise<boolean>;
}

export interface RemoteTerminalProcessOptions {
    cols: number;
    command?: string;
    cwd: string;
    rows: number;
    shell?: string;
}

export interface RemoteTerminalProcessFactory {
    start(options: RemoteTerminalProcessOptions): Promise<RemoteTerminalProcess>;
}
