import type { AgentContext } from "./AgentContext.js";
import type { GoalContext } from "./GoalContext.js";
import type { TaskContext } from "./TaskContext.js";
import type { UserInputContext } from "./UserInputContext.js";
import { createFileReadState } from "./FileReadState.js";
import type { WorkflowContext } from "../../workflows/index.js";
import {
    createPermissionContext,
    DEFAULT_PERMISSION_MODE,
    type PermissionMode,
} from "../../permissions/index.js";
import {
    createDockerBashContext,
    createDockerFileSystemContext,
    DockerEnvironment,
    type DockerExecutionConfig,
} from "../../execution/index.js";

export interface CreateDockerAgentContextOptions {
    docker: DockerExecutionConfig;
    goals?: GoalContext;
    permissionMode?: PermissionMode;
    sessionId: string;
    tasks?: TaskContext;
    userInput?: UserInputContext;
    workflows?: WorkflowContext;
}

export function createDockerAgentContext(options: CreateDockerAgentContextOptions): AgentContext {
    const permissions = createPermissionContext(options.permissionMode ?? DEFAULT_PERMISSION_MODE);
    const environment = new DockerEnvironment(options.docker, options.sessionId);
    const context: AgentContext = {
        bash: createDockerBashContext(environment, permissions),
        fileReads: createFileReadState(),
        fs: createDockerFileSystemContext(environment, permissions),
        permissions,
    };
    if (options.userInput !== undefined) context.userInput = options.userInput;
    if (options.goals !== undefined) context.goals = options.goals;
    if (options.tasks !== undefined) context.tasks = options.tasks;
    if (options.workflows !== undefined) context.workflows = options.workflows;
    return context;
}
