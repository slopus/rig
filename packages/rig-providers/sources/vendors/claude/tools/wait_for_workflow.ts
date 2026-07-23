import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_wait_for_workflow_tool: SessionTool = {
    name: "WaitForWorkflow",
    type: "local",
    description:
        "Wait indefinitely for one workflow run to finish and return its consolidated result.\n\nUse this after starting a workflow when the user asked you to wait for its result. Call it once instead of polling workflow status or ending your turn. The call remains active for workflows of any duration and resumes automatically when the workflow completes, fails, or is stopped. If the user cancels this tool call, only the wait is cancelled; the workflow continues running in the background and will still send its completion notification.",
    parameters: Type.Object({
        run_id: Type.String({ description: "Workflow run identifier returned by workflow." }),
    }),
};

export const claude_wait_for_workflow_tool_sonnet: SessionTool = {
    name: "WaitForWorkflow",
    type: "local",
    description:
        "Wait indefinitely for one workflow run to finish and return its consolidated result.\n\nUse this after starting a workflow when the user asked you to wait for its result. Call it once instead of polling workflow status or ending your turn. The call remains active for workflows of any duration and resumes automatically when the workflow completes, fails, or is stopped. If the user cancels this tool call, only the wait is cancelled; the workflow continues running in the background and will still send its completion notification.",
    parameters: Type.Object({
        run_id: Type.String({ description: "Workflow run identifier returned by workflow." }),
    }),
};
