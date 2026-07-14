import type {
    GymInferenceRequest,
    GymInferenceResponse,
} from "../../rig/sources/providers/gym-types.js";

export type GymMockResponse =
    | GymInferenceResponse
    | {
          body?: string;
          httpStatus: number;
      };

export type GymInferenceHandler = (
    request: GymInferenceRequest,
    callIndex: number,
) => GymMockResponse | Promise<GymMockResponse>;

export type GymFixture =
    | string
    | Uint8Array
    | {
          content: string | Uint8Array;
          mode?: number;
      };

export interface GymOptions {
    args?: readonly string[];
    cols?: number;
    dockerSocket?: boolean;
    files?: Readonly<Record<string, GymFixture>>;
    homeFiles?: Readonly<Record<string, GymFixture>>;
    image?: string;
    inference: readonly GymMockResponse[] | GymInferenceHandler;
    permissionMode?: "auto" | "from_config" | "full_access" | "read_only" | "workspace_write";
    rows?: number;
    startupText?: string;
    timeoutMs?: number;
}

export interface TerminalCursorSnapshot {
    visible: boolean;
    x: number;
    y: number;
}

export interface TerminalScrollSnapshot {
    atBottom: boolean;
    atTop: boolean;
    bottomDepartureCount: number;
    offset: number;
    topArrivalCount: number;
    totalRows: number;
    visibleRows: number;
}

export interface TerminalSnapshot {
    cursor: TerminalCursorSnapshot;
    rows: readonly string[];
    scroll: TerminalScrollSnapshot;
    text: string;
    title: string;
}
