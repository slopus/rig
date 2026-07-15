export { grokGetCommandOrSubagentOutputTool } from "./get_command_or_subagent_output.js";
export { grokGrepTool } from "./grep.js";
export { grokKillCommandOrSubagentTool } from "./kill_command_or_subagent.js";
export { grokListDirTool } from "./list_dir.js";
export { grokReadFileTool } from "./read_file.js";
export { grokRunTerminalCommandTool } from "./run_terminal_command.js";
export { grokSearchReplaceTool } from "./search_replace.js";
export { grokSpawnSubagentTool } from "./spawn_subagent.js";
export { grokWaitCommandsOrSubagentsTool } from "./wait_commands_or_subagents.js";

import { grokGetCommandOrSubagentOutputTool } from "./get_command_or_subagent_output.js";
import { grokGrepTool } from "./grep.js";
import { grokKillCommandOrSubagentTool } from "./kill_command_or_subagent.js";
import { grokListDirTool } from "./list_dir.js";
import { grokReadFileTool } from "./read_file.js";
import { grokRunTerminalCommandTool } from "./run_terminal_command.js";
import { grokSearchReplaceTool } from "./search_replace.js";
import { grokSpawnSubagentTool } from "./spawn_subagent.js";
import { grokWaitCommandsOrSubagentsTool } from "./wait_commands_or_subagents.js";

export const grokBuildTools = [
    grokRunTerminalCommandTool,
    grokReadFileTool,
    grokSearchReplaceTool,
    grokListDirTool,
    grokGrepTool,
    grokGetCommandOrSubagentOutputTool,
    grokKillCommandOrSubagentTool,
] as const;

export const grokCollaborationTools = [
    grokSpawnSubagentTool,
    grokWaitCommandsOrSubagentsTool,
] as const;
