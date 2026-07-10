import type { BashContext } from "./BashContext.js";
import type { FileSystemContext } from "./FileSystemContext.js";
import type { SubagentContext } from "./SubagentContext.js";
import type { UserInputContext } from "./UserInputContext.js";
import type { PermissionContext } from "../../permissions/index.js";

export interface AgentContext {
    fs: FileSystemContext;
    bash: BashContext;
    permissions?: PermissionContext;
    subagents?: SubagentContext;
    userInput?: UserInputContext;
}
