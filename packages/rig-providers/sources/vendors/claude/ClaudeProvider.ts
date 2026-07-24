import type { ProviderModality } from "@/core/ProviderModality.js";
import { BaseProvider } from "@/core/BaseProvider.js";
import type { SessionOptions } from "@/core/SessionOptions.js";
import type { ClaudeCredential } from "@/vendors/VendorCredential.js";
import { ClaudeSession, type ClaudeSdkQuery } from "@/vendors/claude/ClaudeSession.js";
import { resolveClaudeModelId } from "@/vendors/claude/impl/resolveClaudeModelId.js";
import type {
    ClaudeAuxiliaryQueryRequest,
    ClaudeAuxiliaryQueryResponse,
} from "@/vendors/claude/ClaudeAuxiliaryQuery.js";
import { runClaudeAuxiliaryQuery } from "@/vendors/claude/impl/runClaudeAuxiliaryQuery.js";

export interface ClaudeProviderOptions {
    credential: ClaudeCredential;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    model?: string;
    pathToClaudeCodeExecutable?: string;
    query?: ClaudeSdkQuery;
}

export class ClaudeProvider extends BaseProvider {
    static override readonly name = "claude";
    static override readonly inputTypes: readonly ProviderModality[] = ["text", "image"];
    static override readonly outputTypes: readonly ProviderModality[] = ["text"];

    readonly credential: ClaudeCredential;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv | undefined;
    readonly model: string | undefined;
    readonly pathToClaudeCodeExecutable: string | undefined;
    readonly query: ClaudeSdkQuery | undefined;

    constructor(options: ClaudeProviderOptions) {
        super();
        this.credential = options.credential;
        this.cwd = options.cwd;
        this.env = options.env;
        this.model = options.model === undefined ? undefined : resolveClaudeModelId(options.model);
        this.pathToClaudeCodeExecutable = options.pathToClaudeCodeExecutable;
        this.query = options.query;
    }

    override async session(id: string, options: SessionOptions): Promise<ClaudeSession> {
        return new ClaudeSession(id, {
            ...options,
            credential: this.credential,
            cwd: this.cwd,
            ...(this.env === undefined ? {} : { env: this.env }),
            ...(this.model === undefined ? {} : { model: this.model }),
            ...(this.pathToClaudeCodeExecutable === undefined
                ? {}
                : { pathToClaudeCodeExecutable: this.pathToClaudeCodeExecutable }),
            ...(this.query === undefined ? {} : { query: this.query }),
        });
    }

    runAuxiliaryQuery(
        model: string,
        request: ClaudeAuxiliaryQueryRequest,
    ): Promise<ClaudeAuxiliaryQueryResponse> {
        return runClaudeAuxiliaryQuery({
            credential: this.credential,
            cwd: this.cwd,
            ...(this.env === undefined ? {} : { env: this.env }),
            model: resolveClaudeModelId(model),
            ...(this.pathToClaudeCodeExecutable === undefined
                ? {}
                : { pathToClaudeCodeExecutable: this.pathToClaudeCodeExecutable }),
            ...(this.query === undefined ? {} : { query: this.query }),
            request,
        });
    }
}
