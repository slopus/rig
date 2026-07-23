import type { SessionContext } from "@/core/SessionContext.js";
import type { SessionCompaction, SessionCompactionOptions } from "@/core/SessionCompaction.js";
import type { SessionEvent, SessionStream } from "@/core/SessionEvent.js";
import type { SessionRunRequest } from "@/core/SessionRunRequest.js";

export abstract class BaseSession {
    readonly id: string;
    protected constructor(id: string) {
        this.id = id;
    }

    abstract run(request: SessionRunRequest): SessionStream;

    abstract compact(options?: SessionCompactionOptions): Promise<SessionCompaction>;

    abstract destroy(): void | Promise<void>;
}

export type { SessionCompaction, SessionContext, SessionEvent, SessionRunRequest, SessionStream };
