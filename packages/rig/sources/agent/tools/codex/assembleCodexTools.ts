import type { AnyDefinedTool } from "../../types.js";
import { codexStopWorkflowTool } from "../../../tools/workflows/stop_workflow.js";
import { codexWaitForWorkflowTool } from "../../../tools/workflows/waitForWorkflowTools.js";
import { codexWorkflowTool } from "../../../tools/workflows/workflowTools.js";
import { codexWorkflowStatusTool } from "../../../tools/workflows/workflow_status.js";
import { codexApplyPatchTool } from "./apply_patch.js";
import { codexExecCommandTool } from "./exec_command.js";
import { codexRequestUserInputTool } from "./request_user_input.js";
import { codexUpdatePlanTool } from "./update_plan.js";
import { codexViewImageTool } from "./view_image.js";
import { codexWriteStdinTool } from "./write_stdin.js";
import { codexV1CloseAgentTool } from "./v1/close_agent.js";
import { codexV1ResumeAgentTool } from "./v1/resume_agent.js";
import { codexV1SendInputTool } from "./v1/send_input.js";
import { codexV1SpawnAgentTool } from "./v1/spawn_agent.js";
import { codexV1WaitAgentTool } from "./v1/wait_agent.js";
import { codexFollowupTaskTool } from "./v2/followup_task.js";
import { codexInterruptAgentTool } from "./v2/interrupt_agent.js";
import { codexListAgentsTool } from "./v2/list_agents.js";
import { codexSendMessageTool } from "./v2/send_message.js";
import { codexSpawnAgentTool } from "./v2/spawn_agent.js";
import { codexWaitAgentTool } from "./v2/wait_agent.js";

export const codexTools = [
    codexExecCommandTool,
    codexWriteStdinTool,
    codexUpdatePlanTool,
    codexRequestUserInputTool,
    codexApplyPatchTool,
    codexViewImageTool,
] as const;

const codexWorkflowTools = [
    codexWorkflowTool,
    codexWaitForWorkflowTool,
    codexWorkflowStatusTool,
    codexStopWorkflowTool,
] as const;

export const codexV2CollaborationTools = [
    codexSpawnAgentTool,
    codexFollowupTaskTool,
    codexSendMessageTool,
    codexWaitAgentTool,
    codexListAgentsTool,
    codexInterruptAgentTool,
] as const;

export const codexV1CollaborationTools = [
    codexV1CloseAgentTool,
    codexV1ResumeAgentTool,
    codexV1SendInputTool,
    codexV1SpawnAgentTool,
    codexV1WaitAgentTool,
] as const;

export const codexCollaborationTools = [
    ...codexWorkflowTools,
    ...codexV1CollaborationTools,
    ...codexV2CollaborationTools,
] as const;

export function assembleCodexTools(
    modelName: string,
    providerName: string,
): readonly AnyDefinedTool[] {
    void modelName;
    const collaborationTools =
        providerName === "bedrock" ? codexV1CollaborationTools : codexV2CollaborationTools;
    return [...codexTools, ...codexWorkflowTools, ...collaborationTools];
}
