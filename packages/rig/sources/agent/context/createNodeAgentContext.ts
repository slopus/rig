import type { NativeProxessManager } from "../../processes/index.js";
import type { AgentContext } from "./AgentContext.js";
import type { GoalContext } from "./GoalContext.js";
import { createFileReadState } from "./FileReadState.js";
import { createNodeBashContext } from "./createNodeBashContext.js";
import { createNodeFileSystemContext } from "./createNodeFileSystemContext.js";
import type { UserInputContext } from "./UserInputContext.js";
import type { TaskContext } from "./TaskContext.js";
import type { WorkflowContext } from "../../workflows/index.js";
import {
    createPermissionContext,
    DEFAULT_PERMISSION_MODE,
    type PermissionMode,
} from "../../permissions/index.js";

export interface CreateNodeAgentContextOptions {
    cwd: string;
    goals?: GoalContext;
    processManager: NativeProxessManager;
    permissionMode?: PermissionMode;
    tasks?: TaskContext;
    userInput?: UserInputContext;
    workflows?: WorkflowContext;
}

export function createNodeAgentContext(options: CreateNodeAgentContextOptions): AgentContext {
    const permissions = createPermissionContext(options.permissionMode ?? DEFAULT_PERMISSION_MODE);
    const context: AgentContext = {
        fs: createNodeFileSystemContext(options.cwd, {
            permissionMode: () => permissions.mode,
        }),
        bash: createNodeBashContext({
            cwd: options.cwd,
            processManager: options.processManager,
            permissions,
        }),
        fileReads: createFileReadState(),
        permissions,
    };
    if (options.userInput !== undefined) context.userInput = options.userInput;
    if (options.goals !== undefined) context.goals = options.goals;
    if (options.tasks !== undefined) context.tasks = options.tasks;
    if (options.workflows !== undefined) context.workflows = options.workflows;
    return context;
}
