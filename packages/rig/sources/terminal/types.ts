export type RemoteTerminalStatus = "exited" | "running";

export interface CreateRemoteTerminalRequest {
    cols?: number;
    command?: string;
    cwd?: string;
    maxScrollback?: number;
    rows?: number;
    shell?: string;
}

export interface RemoteTerminalSummary {
    cols: number;
    epoch: string;
    exitCode: number | null;
    id: string;
    rows: number;
    status: RemoteTerminalStatus;
}

export interface CreateRemoteTerminalResponse {
    terminal: RemoteTerminalSummary;
}

export interface ListRemoteTerminalsResponse {
    terminals: readonly RemoteTerminalSummary[];
}

export interface ResizeRemoteTerminalRequest {
    cols: number;
    rows: number;
}

export interface RemoteTerminalResponse {
    terminal: RemoteTerminalSummary;
}
