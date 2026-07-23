import type { ProviderModality } from "@/core/ProviderModality.js";
import type { SessionOptions } from "@/core/SessionOptions.js";
import { ResponsesProvider } from "@/responses/ResponsesProvider.js";
import type { BedrockCredential } from "@/vendors/VendorCredential.js";
import { BedrockSession } from "@/vendors/bedrock/BedrockSession.js";
import { assertBedrockCredential } from "@/vendors/bedrock/impl/assertBedrockCredential.js";
import { BEDROCK_DEFAULT_REGION } from "@/vendors/bedrock/impl/bedrockConstants.js";
import { resolveCodexUserAgent } from "@/vendors/codex/impl/codexUserAgent.js";

export interface BedrockProviderOptions {
    credential: BedrockCredential;
    endpoint?: string;
    model?: string;
    region?: string;
}

export class BedrockProvider extends ResponsesProvider {
    static override readonly name = "bedrock";
    static override readonly inputTypes: readonly ProviderModality[] = ["text"];
    static override readonly outputTypes: readonly ProviderModality[] = ["text"];
    readonly credential: BedrockCredential;
    readonly endpoint: string | undefined;
    readonly model: string | undefined;
    readonly region: string;

    constructor(options: BedrockProviderOptions) {
        super();
        assertBedrockCredential(options.credential);
        this.credential = options.credential;
        this.endpoint = options.endpoint;
        this.model = options.model;
        this.region =
            options.region?.trim() ||
            process.env.AWS_REGION?.trim() ||
            process.env.AWS_DEFAULT_REGION?.trim() ||
            BEDROCK_DEFAULT_REGION;
    }

    override async session(id: string, options: SessionOptions): Promise<BedrockSession> {
        const userAgent = await resolveCodexUserAgent();
        return new BedrockSession(id, {
            ...options,
            credential: this.credential,
            ...(this.model === undefined ? {} : { model: this.model }),
            region: this.region,
            userAgent,
            ...(this.endpoint === undefined ? {} : { endpoint: this.endpoint }),
        });
    }
}
