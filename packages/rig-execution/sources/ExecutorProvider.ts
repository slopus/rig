import type { BaseProvider, ProviderQuota } from "@slopus/rig-providers";

import type { ExecutorModelProfile } from "@/ExecutorModelProfile.js";
import type { ProfilePromptContext, ServiceTier } from "@/types.js";

export interface ExecutorProvider {
    destroy?(): Promise<void> | void;
    extendProfilePromptContext?: (
        context: ProfilePromptContext,
    ) => ProfilePromptContext | Promise<ProfilePromptContext>;
    id: string;
    native: BaseProvider | ((profile: ExecutorModelProfile) => Promise<BaseProvider>);
    nativeKey?: (profile: ExecutorModelProfile) => string;
    profiles: readonly ExecutorModelProfile[];
    quota?(options?: { fresh?: boolean }): Promise<ProviderQuota>;
    serviceTiers?: readonly ServiceTier[];
    sessionId?: string;
}
