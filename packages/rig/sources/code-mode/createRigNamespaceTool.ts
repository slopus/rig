import type { AnyDefinedTool } from "../agent/types.js";
import { assertRigAgentToolArguments } from "./assertRigAgentToolArguments.js";
import { describeRigAgentToolAutoPermissionAction } from "./describeRigAgentToolAutoPermissionAction.js";
import { shouldReviewRigAgentToolInAutoMode } from "./shouldReviewRigAgentToolInAutoMode.js";

export function createRigNamespaceTool(tool: AnyDefinedTool): AnyDefinedTool {
    return {
        ...tool,
        codeMode: { ...tool.codeMode, exposure: "nested", namespace: "rig" },
        ...(tool.name === "spawn_agent" || tool.name === "followup_task"
            ? {
                  describeAutoPermissionAction: (args: never) =>
                      describeRigAgentToolAutoPermissionAction(tool.name, args),
                  shouldReviewInAutoMode: (args: never) =>
                      shouldReviewRigAgentToolInAutoMode(tool.name, args),
              }
            : {}),
        execute: (args, context, execution) => {
            assertRigAgentToolArguments(tool.name, args);
            return tool.execute(args, context, execution);
        },
    };
}
