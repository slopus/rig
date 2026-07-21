export type HappyEncryptionVariant = "dataKey" | "legacy";

export type HappyCredentials =
    | {
          encryption: { secret: Uint8Array; type: "legacy" };
          token: string;
      }
    | {
          encryption: { machineKey: Uint8Array; publicKey: Uint8Array; type: "dataKey" };
          token: string;
      };

export interface HappyConnectionConfiguration {
    credentials: HappyCredentials;
    credentialsPath: string;
    happyHome: string;
    imported: boolean;
    machineId?: string;
    serverUrl: string;
}

export interface HappySessionMetadata {
    activity: {
        processes: { running: number };
        subagents: { queued: number; running: number; total: number };
        tasks: { completed: number; inProgress: number; pending: number; total: number };
        workflows: { running: number; total: number };
    };
    capabilities: {
        abort: boolean;
        attachments: { enabled: boolean; maxBytes: number; mediaTypes: readonly string[] };
        files: {
            browse: boolean;
            read: boolean;
            search: boolean;
            write: boolean;
        };
        modelSelection: boolean;
        permissionModeSelection: boolean;
        reasoningSelection: boolean;
        resume: boolean;
        rpcMethods: readonly string[];
        shell: boolean;
        steering: boolean;
    };
    client: { id: "rig"; name: "Rig"; version: string };
    currentModelCode: string;
    currentModelProviderId: string;
    currentOperatingModeCode: string;
    currentThoughtLevelCode?: string;
    flavor: string;
    happyHomeDir: string;
    happyLibDir: string;
    happyToolsDir: string;
    homeDir: string;
    host: string;
    hostPid: number;
    machineId?: string;
    mcpServers: readonly { name: string; status: string }[];
    models: readonly {
        code: string;
        contextWindow?: number;
        defaultThinkingLevel: string;
        id: string;
        name: string;
        provider: HappyProviderDescriptor;
        providerId: string;
        providerKind: string;
        providerName: string;
        serviceTiers: readonly string[];
        thinkingLevels: readonly string[];
        value: string;
    }[];
    operatingModes: readonly {
        code: string;
        description: string;
        kind: HappyPermissionModeKind;
        value: string;
    }[];
    name: string;
    os: string;
    path: string;
    model: { id: string; providerId: string };
    permissionMode: string;
    provider: HappyProviderDescriptor;
    providers: readonly HappyProviderDescriptor[];
    reasoning: { current: string | null; levels: readonly string[] };
    rigMetadataVersion: 1;
    session: {
        modelLocked: boolean;
        permissionMode: string;
        serviceTier?: string;
        status: string;
    };
    skills: readonly string[];
    startedBy: "daemon";
    startedFromDaemon: true;
    summary: { text: string; updatedAt: number };
    thoughtLevels: readonly { code: string; value: string }[];
    tools: readonly string[];
}

export interface HappyProviderDescriptor {
    id: string;
    kind: string;
    name: string;
}

export type HappyRemoteInput =
    | { kind: "echo" }
    | {
          kind: "attachment";
          mimeType?: string;
          name: string;
          ref: string;
          size: number;
      }
    | {
          kind: "text";
          meta: {
              effort?: string;
              modelId?: string;
              permissionMode?: string;
              providerId?: string;
          };
          text: string;
      };

export type HappyPermissionModeKind = "default" | "read-only" | "safe-yolo" | "yolo";

export interface HappyUsage {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    context_window?: number;
    input_tokens: number;
    output_tokens: number;
    service_tier?: string;
}

export type HappySessionEvent =
    | { t: "file"; ref: string; name: string; size: number; mimeType?: string }
    | { t: "service"; text: string }
    | { t: "start"; title?: string }
    | { t: "stop" }
    | { t: "text"; text: string; thinking?: boolean }
    | { t: "tool-call-end"; call: string }
    | {
          t: "tool-call-start";
          args: Record<string, unknown>;
          call: string;
          description: string;
          name: string;
          title: string;
      }
    | { t: "turn-end"; status: "cancelled" | "completed" | "failed" }
    | { t: "turn-start" };

export interface HappySessionEnvelope {
    ev: HappySessionEvent;
    id: string;
    role: "agent" | "user";
    time: number;
    turn?: string;
    usage?: HappyUsage;
}

export interface HappySessionProtocolMessage {
    content: HappySessionEnvelope;
    localId: string;
    meta: { sentFrom: "rig" };
    role: "session";
}

export interface HappyStoredCredentials {
    encryption?: { machineKey: string; publicKey: string };
    secret?: string;
    token: string;
}

export interface HappyRemoteMessage {
    content: { c: string; t: "encrypted" };
    createdAt: number;
    id: string;
    localId: string | null;
    seq: number;
    updatedAt: number;
}
