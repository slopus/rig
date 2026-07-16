import type { PartialRigConfig } from "./types.js";

export function createProjectConfigSecurityNoticeTitle(config: PartialRigConfig): string {
    const permission = config.defaults?.permissionMode !== undefined;
    const docker = config.docker !== undefined;
    const providers = config.providers !== undefined;
    const durableEventQueue = config.settings?.durableGlobalEventQueue !== undefined;
    if (durableEventQueue && (permission || docker || providers)) {
        return "Project machine settings ignored";
    }
    if (durableEventQueue) return "Project daemon setting ignored";
    if (providers && (permission || docker)) return "Project machine settings ignored";
    if (providers) return "Project provider settings ignored";
    if (permission && docker) return "Project execution settings ignored";
    if (docker) return "Project Docker ignored";
    if (permission) return "Project permission ignored";
    return "Project settings ignored";
}
