import type { Bash } from "just-bash";

import type { AgentContext } from "./AgentContext.js";
import { createFileReadState } from "./FileReadState.js";
import { createJustBashBashContext } from "./createJustBashBashContext.js";
import { createJustBashFileSystemContext } from "./createJustBashFileSystemContext.js";
import { createPermissionContext } from "../../permissions/index.js";

export function createJustBashAgentContext(bash: Bash, cwd: string): AgentContext {
    return {
        fs: createJustBashFileSystemContext(bash, cwd),
        bash: createJustBashBashContext(bash, cwd),
        fileReads: createFileReadState(),
        permissions: createPermissionContext("full_access"),
    };
}
