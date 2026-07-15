import type { PartialRigConfig } from "./types.js";

export function createProjectConfigSecurityNoticeTitle(config: PartialRigConfig): string {
    const permission = config.defaults?.permissionMode !== undefined;
    const docker = config.docker !== undefined;
    const providers = config.providers !== undefined;
    if (providers && (permission || docker)) return "Project machine settings ignored";
    if (providers) return "Project provider settings ignored";
    if (permission && docker) return "Project execution settings ignored";
    return docker ? "Project Docker ignored" : "Project permission ignored";
}
