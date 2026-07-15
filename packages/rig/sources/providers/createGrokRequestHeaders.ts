import { randomUUID } from "node:crypto";

import { GROK_BUILD_CLIENT_VERSION } from "./grok-constants.js";
import { isGrokProxyBaseUrl } from "./isGrokProxyBaseUrl.js";

export function createGrokRequestHeaders(options: {
    baseUrl: string;
    model: string;
    sessionId?: string;
    turnIndex?: number;
}): Record<string, string> {
    const sessionId = options.sessionId ?? randomUUID();
    return {
        "user-agent": "rig/grok-build",
        "x-grok-agent-id": sessionId,
        "x-grok-client-identifier": "grok-shell",
        "x-grok-client-version": GROK_BUILD_CLIENT_VERSION,
        "x-grok-conv-id": sessionId,
        "x-grok-model-override": options.model,
        "x-grok-req-id": randomUUID(),
        "x-grok-session-id": sessionId,
        ...(options.turnIndex === undefined
            ? {}
            : { "x-grok-turn-idx": String(options.turnIndex) }),
        ...(isGrokProxyBaseUrl(options.baseUrl)
            ? {
                  "x-authenticateresponse": "authenticate-response",
                  "x-grok-client-mode": "interactive",
                  "x-xai-token-auth": "xai-grok-cli",
              }
            : {}),
    };
}
