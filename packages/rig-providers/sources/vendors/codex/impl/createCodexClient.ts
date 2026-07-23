import OpenAI, { BedrockOpenAI } from "openai";

import type { CodexProviderCredential } from "@/vendors/VendorCredential.js";

export function createCodexClient(options: {
    credential: CodexProviderCredential;
    endpoint: string;
    installationId: string;
    sessionId: string;
    userAgent: string;
    windowId: string;
}): OpenAI {
    if (options.credential.name === "bedrock-bearer-token") {
        return new BedrockOpenAI({
            apiKey: options.credential.credential.bearerToken,
            awsRegion: "us-east-1",
            baseURL: options.endpoint,
            defaultHeaders: {
                "x-amzn-mantle-client-agent": "codex",
                "x-codex-beta-features": "remote_compaction_v2",
                originator: "codex_exec",
                "user-agent": options.userAgent,
                "session-id": options.sessionId,
                "thread-id": options.sessionId,
                "x-client-request-id": options.sessionId,
                "x-codex-installation-id": options.installationId,
                "x-codex-window-id": options.windowId,
            },
            maxRetries: 0,
        });
    }
    const accountId =
        options.credential.name === "codex-session"
            ? options.credential.credential.accountId
            : undefined;
    if (options.credential.name === "codex-session" && accountId === undefined) {
        throw new Error("Codex authentication is missing a ChatGPT account ID.");
    }
    return new OpenAI({
        apiKey:
            options.credential.name === "codex-session"
                ? options.credential.credential.accessToken
                : options.credential.credential.apiKey,
        baseURL:
            options.credential.name === "codex-session"
                ? `${options.endpoint.replace(/\/$/u, "")}/codex`
                : options.endpoint,
        defaultHeaders: {
            ...(accountId === undefined ? {} : { "chatgpt-account-id": accountId }),
            originator: "codex_exec",
            "user-agent": options.userAgent,
            "session-id": options.sessionId,
            "thread-id": options.sessionId,
            "x-client-request-id": options.sessionId,
            "x-codex-beta-features": "remote_compaction_v2",
            "x-codex-installation-id": options.installationId,
            "x-codex-window-id": options.windowId,
        },
        maxRetries: 0,
    });
}
