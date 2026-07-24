import type { ProviderModality } from "@/core/ProviderModality.js";
import type { SessionOptions } from "@/core/SessionOptions.js";
import { ResponsesProvider } from "@/responses/ResponsesProvider.js";
import type { CodexProviderCredential } from "@/vendors/VendorCredential.js";
import {
    BEDROCK_DEFAULT_REGION,
    bedrockMantleEndpoint,
} from "@/vendors/bedrock/impl/bedrockConstants.js";
import { CodexSession } from "@/vendors/codex/CodexSession.js";
import { assertCodexCredential } from "@/vendors/codex/impl/assertCodexCredential.js";
import { resolveCodexInstallationId } from "@/vendors/codex/impl/resolveCodexInstallationId.js";
import { resolveCodexModelId } from "@/vendors/codex/impl/resolveCodexModelId.js";
import { resolveCodexUserAgent } from "@/vendors/codex/impl/codexUserAgent.js";
import { resolveCodexStreamIdleTimeout } from "@/vendors/codex/impl/resolveCodexStreamIdleTimeout.js";
import { resolveCodexStreamMaxRetries } from "@/vendors/codex/impl/resolveCodexStreamMaxRetries.js";
import {
    CODEX_API_ENDPOINT,
    CODEX_CHATGPT_ENDPOINT,
    type CodexTransport,
} from "@/vendors/codex/impl/codexConstants.js";

export interface CodexProviderOptions {
    credential: CodexProviderCredential;
    endpoint?: string;
    model?: string;
    /** Enables multi-call batches; Codex v2 uses standard Responses instead of Responses Lite. */
    parallelToolCalls?: boolean;
    region?: string;
    /** Maximum stream reconnection attempts per transport, matching upstream Codex. */
    streamMaxRetries?: number;
    /** Maximum time a connected stream may remain idle, matching upstream Codex. */
    streamIdleTimeoutMs?: number;
    transport?: CodexTransport;
    /** Override only when replaying a captured native request. */
    userAgent?: string;
}

export class CodexProvider extends ResponsesProvider {
    static override readonly name = "codex";
    static override readonly inputTypes: readonly ProviderModality[] = ["text", "image"];
    static override readonly outputTypes: readonly ProviderModality[] = ["text"];

    readonly credential: CodexProviderCredential;
    readonly endpoint: string;
    readonly model: string | undefined;
    readonly parallelToolCalls: boolean | undefined;
    readonly streamMaxRetries: number;
    readonly streamIdleTimeoutMs: number;
    readonly transport: CodexTransport;
    readonly userAgent: string | undefined;

    constructor(options: CodexProviderOptions) {
        super();
        assertCodexCredential(options.credential);
        this.credential = options.credential;
        const isBedrock = options.credential.name === "bedrock-bearer-token";
        const region =
            options.region?.trim() ||
            process.env.AWS_REGION?.trim() ||
            process.env.AWS_DEFAULT_REGION?.trim() ||
            BEDROCK_DEFAULT_REGION;
        this.endpoint =
            options.endpoint ??
            (isBedrock
                ? bedrockMantleEndpoint(region)
                : options.credential.name === "codex-session"
                  ? CODEX_CHATGPT_ENDPOINT
                  : CODEX_API_ENDPOINT);
        this.model = options.model === undefined ? undefined : resolveCodexModelId(options.model);
        this.parallelToolCalls = options.parallelToolCalls;
        this.streamMaxRetries = resolveCodexStreamMaxRetries(options.streamMaxRetries);
        this.streamIdleTimeoutMs = resolveCodexStreamIdleTimeout(options.streamIdleTimeoutMs);
        this.transport = isBedrock ? "sse" : (options.transport ?? "auto");
        this.userAgent = options.userAgent;
    }

    override async session(id: string, options: SessionOptions): Promise<CodexSession> {
        const installationId = await resolveCodexInstallationId();
        const userAgent = this.userAgent ?? (await resolveCodexUserAgent());
        return new CodexSession(id, {
            ...options,
            credential: this.credential,
            endpoint: this.endpoint,
            installationId,
            ...(this.model === undefined ? {} : { model: this.model }),
            ...(this.parallelToolCalls === undefined
                ? {}
                : { parallelToolCalls: this.parallelToolCalls }),
            streamMaxRetries: this.streamMaxRetries,
            streamIdleTimeoutMs: this.streamIdleTimeoutMs,
            transport: this.transport,
            userAgent,
        });
    }
}
