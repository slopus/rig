import type { ContentBlock } from "../agent/types.js";

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ExternalToolDefinition {
    description: string;
    label?: string;
    name: string;
    parameters: JsonSchema;
}

export interface ExternalToolCall {
    arguments: unknown;
    batchId: string;
    createdAt: number;
    definition: ExternalToolDefinition;
    id: string;
    runId: string;
    sessionId: string;
    status: "pending" | "completed" | "failed" | "cancelled";
    toolCallId: string;
    toolCallIndex: number;
    consumed: boolean;
    resolution?: ExternalToolCallResolution;
    resolvedAt?: number;
}

export type ExternalToolCallResolution =
    | {
          status: "completed";
          content?: readonly ContentBlock[];
          output?: unknown;
      }
    | {
          status: "failed";
          error: {
              code?: string;
              data?: unknown;
              message: string;
          };
      };

export interface ResolveExternalToolCallResponse {
    accepted: boolean;
    call: ExternalToolCall;
}
