export interface BashRunOptions {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
    shell?: string;
    signal?: AbortSignal;
}

export interface BashRunResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
}

export type BashSessionStatus = "completed" | "killed" | "running";

export interface BashSessionSnapshot {
    command: string;
    cwd: string;
    exitCode: number | null;
    sessionId: number;
    status: BashSessionStatus;
    stderr: string;
    stderrDelta: string;
    stdout: string;
    stdoutDelta: string;
    timedOut: boolean;
}

export interface BashSessionReadOptions {
    signal?: AbortSignal;
    waitMs?: number;
}

export interface BashSessionActivity {
    command: string;
    cwd: string;
    sessionId: number;
    status: "running";
}

export interface BashContext {
    activeSessionCount?(): number;
    activeSessions?(): readonly BashSessionActivity[];
    cwd: string;
    killAllSessions?(): Promise<number>;
    killSession(sessionId: number): Promise<BashSessionSnapshot | undefined>;
    readSession(
        sessionId: number,
        options?: BashSessionReadOptions,
    ): Promise<BashSessionSnapshot | undefined>;
    run(options: BashRunOptions): Promise<BashRunResult>;
    setActiveSessionCountListener?(listener: ((count: number) => void) | undefined): void;
    startSession(options: Omit<BashRunOptions, "signal">): Promise<number>;
    supportsSessionInput: boolean;
    writeSession(sessionId: number, data: string | Uint8Array): Promise<boolean>;
}
