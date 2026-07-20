import type { BashContext } from "./BashContext.js";
import type { ChatHistoryContext } from "./ChatHistoryContext.js";
import type { FileReadState } from "./FileReadState.js";
import type { FileSystemContext } from "./FileSystemContext.js";
import type { GoalContext } from "./GoalContext.js";
import type { SubagentContext } from "./SubagentContext.js";
import type { UserInputContext } from "./UserInputContext.js";
import type { TaskContext } from "./TaskContext.js";
import type { PermissionContext } from "../../permissions/index.js";
import type { WorkflowContext } from "../../workflows/index.js";
import type { SessionSecretContext } from "../../secrets/index.js";

export interface AgentContext {
    fs: FileSystemContext;
    bash: BashContext;
    chatHistory?: ChatHistoryContext;
    fileReads?: FileReadState;
    goals?: GoalContext;
    permissions?: PermissionContext;
    secrets?: SessionSecretContext;
    subagents?: SubagentContext;
    tasks?: TaskContext;
    userInput?: UserInputContext;
    workflows?: WorkflowContext;
}
