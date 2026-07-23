import { randomUUID } from "node:crypto";

import { GROK_BUILD_CLIENT_VERSION } from "@/vendors/grok/impl/grokConstants.js";
import { isGrokProxyBaseUrl } from "@/vendors/grok/impl/isGrokProxyBaseUrl.js";
import { createGrokUserAgent } from "@/vendors/grok/impl/createGrokUserAgent.js";

export function createGrokRequestHeaders(options: {
    baseUrl: string;
    model: string;
    sessionId?: string;
    turnIndex?: number;
}): Record<string, string> {
    const sessionId = options.sessionId ?? randomUUID();
    return {
        accept: "text/event-stream",
        "user-agent": createGrokUserAgent(),
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
                  "x-grok-client-mode": "headless",
                  "x-xai-token-auth": "xai-grok-cli",
              }
            : {}),
    };
}
