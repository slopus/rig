import type { AnyDefinedTool } from "../../types.js";
import { claudeWaitForWorkflowTool, claudeWorkflowTool } from "../../../tools/workflows/index.js";
import { claudeAgentTool } from "./Agent.js";
import { claudeAskUserQuestionTool } from "./AskUserQuestion.js";
import { claudeBashTool } from "./Bash.js";
import { claudeEditTool } from "./Edit.js";
import { claudeGlobTool } from "./Glob.js";
import { claudeGrepTool } from "./Grep.js";
import { claudeReadTool } from "./Read.js";
import { claudeSendMessageTool } from "./SendMessage.js";
import { claudeTaskCreateTool } from "./TaskCreate.js";
import { claudeTaskGetTool } from "./TaskGet.js";
import { claudeTaskListTool } from "./TaskList.js";
import { claudeTaskOutputTool } from "./TaskOutput.js";
import { claudeTaskStopTool } from "./TaskStop.js";
import { claudeTaskUpdateTool } from "./TaskUpdate.js";
import { claudeWebFetchTool } from "./WebFetch.js";
import { claudeWebSearchTool } from "./WebSearch.js";
import { claudeWriteTool } from "./Write.js";

export const claudeTools = [
    claudeTaskOutputTool,
    claudeBashTool,
    claudeReadTool,
    claudeEditTool,
    claudeWriteTool,
    claudeGlobTool,
    claudeGrepTool,
    claudeTaskCreateTool,
    claudeTaskGetTool,
    claudeTaskUpdateTool,
    claudeTaskListTool,
    claudeWebFetchTool,
    claudeWebSearchTool,
    claudeTaskStopTool,
    claudeAskUserQuestionTool,
] as const;

export const claudeCollaborationTools = [
    claudeAgentTool,
    claudeWorkflowTool,
    claudeWaitForWorkflowTool,
    claudeSendMessageTool,
] as const;

export function assembleClaudeTools(): readonly AnyDefinedTool[] {
    return [...claudeTools, ...claudeCollaborationTools];
}
