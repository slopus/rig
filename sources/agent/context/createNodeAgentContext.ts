import type { NativeProxessManager } from "../../processes/index.js";
import type { AgentContext } from "./AgentContext.js";
import { createNodeBashContext } from "./createNodeBashContext.js";
import { createNodeFileSystemContext } from "./createNodeFileSystemContext.js";
import type { UserInputContext } from "./UserInputContext.js";
import type { TaskContext } from "./TaskContext.js";
import {
    createPermissionContext,
    DEFAULT_PERMISSION_MODE,
    type PermissionMode,
} from "../../permissions/index.js";

export interface CreateNodeAgentContextOptions {
    cwd: string;
    processManager: NativeProxessManager;
    permissionMode?: PermissionMode;
    tasks?: TaskContext;
    userInput?: UserInputContext;
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
        permissions,
    };
    if (options.userInput !== undefined) context.userInput = options.userInput;
    if (options.tasks !== undefined) context.tasks = options.tasks;
    return context;
}
