import type { PartialRigConfig } from "./types.js";

export function createProjectConfigSecurityNoticeTitle(config: PartialRigConfig): string {
    const permission = config.defaults?.permissionMode !== undefined;
    const docker = config.docker !== undefined;
    if (permission && docker) return "Project execution settings ignored";
    return docker ? "Project Docker ignored" : "Project permission ignored";
}
