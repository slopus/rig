import type { BashContext } from "./BashContext.js";
import type { FileSystemContext } from "./FileSystemContext.js";
import type { SubagentContext } from "./SubagentContext.js";
import type { UserInputContext } from "./UserInputContext.js";
import type { TaskContext } from "./TaskContext.js";
import type { PermissionContext } from "../../permissions/index.js";

export interface AgentContext {
    fs: FileSystemContext;
    bash: BashContext;
    permissions?: PermissionContext;
    subagents?: SubagentContext;
    tasks?: TaskContext;
    userInput?: UserInputContext;
}
