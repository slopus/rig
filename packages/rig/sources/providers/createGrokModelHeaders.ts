import { GROK_BUILD_CLIENT_VERSION } from "./grok-constants.js";
import type { GrokAuthRecord, GrokCredential } from "./grok-auth-types.js";
import { isGrokProxyBaseUrl } from "./isGrokProxyBaseUrl.js";

export function createGrokModelHeaders(options: {
    baseUrl: string;
    credential: GrokCredential;
    record?: GrokAuthRecord;
}): Record<string, string> {
    return {
        authorization: `Bearer ${options.credential.token}`,
        "x-grok-client-version": GROK_BUILD_CLIENT_VERSION,
        ...(isGrokProxyBaseUrl(options.baseUrl) && options.credential.source === "session"
            ? {
                  "x-grok-client-mode": "interactive",
                  "x-xai-token-auth": "xai-grok-cli",
                  ...(typeof options.record?.user_id === "string"
                      ? { "x-userid": options.record.user_id }
                      : {}),
                  ...(typeof options.record?.email === "string"
                      ? { "x-email": options.record.email }
                      : {}),
              }
            : {}),
    };
}
