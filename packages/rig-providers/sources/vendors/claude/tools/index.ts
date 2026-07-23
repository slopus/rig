import { claude_agent_tool, claude_agent_tool_sonnet } from "@/vendors/claude/tools/agent.js";
import {
    claude_task_output_tool,
    claude_task_output_tool_sonnet,
} from "@/vendors/claude/tools/task_output.js";
import { claude_bash_tool, claude_bash_tool_sonnet } from "@/vendors/claude/tools/bash.js";
import { claude_read_tool, claude_read_tool_sonnet } from "@/vendors/claude/tools/read.js";
import { claude_edit_tool, claude_edit_tool_sonnet } from "@/vendors/claude/tools/edit.js";
import { claude_write_tool, claude_write_tool_sonnet } from "@/vendors/claude/tools/write.js";
import { claude_glob_tool, claude_glob_tool_sonnet } from "@/vendors/claude/tools/glob.js";
import { claude_grep_tool, claude_grep_tool_sonnet } from "@/vendors/claude/tools/grep.js";
import {
    claude_task_create_tool,
    claude_task_create_tool_sonnet,
} from "@/vendors/claude/tools/task_create.js";
import {
    claude_task_get_tool,
    claude_task_get_tool_sonnet,
} from "@/vendors/claude/tools/task_get.js";
import {
    claude_task_update_tool,
    claude_task_update_tool_sonnet,
} from "@/vendors/claude/tools/task_update.js";
import {
    claude_task_list_tool,
    claude_task_list_tool_sonnet,
} from "@/vendors/claude/tools/task_list.js";
import {
    claude_web_fetch_tool,
    claude_web_fetch_tool_sonnet,
} from "@/vendors/claude/tools/web_fetch.js";
import {
    claude_web_search_tool,
    claude_web_search_tool_sonnet,
} from "@/vendors/claude/tools/web_search.js";
import {
    claude_task_stop_tool,
    claude_task_stop_tool_sonnet,
} from "@/vendors/claude/tools/task_stop.js";
import {
    claude_ask_user_question_tool,
    claude_ask_user_question_tool_sonnet,
} from "@/vendors/claude/tools/ask_user_question.js";
import {
    claude_workflow_tool,
    claude_workflow_tool_sonnet,
} from "@/vendors/claude/tools/workflow.js";
import {
    claude_wait_for_workflow_tool,
    claude_wait_for_workflow_tool_sonnet,
} from "@/vendors/claude/tools/wait_for_workflow.js";
import {
    claude_send_message_tool,
    claude_send_message_tool_sonnet,
} from "@/vendors/claude/tools/send_message.js";

export const claude_tools = [
    claude_agent_tool,
    claude_task_output_tool,
    claude_bash_tool,
    claude_read_tool,
    claude_edit_tool,
    claude_write_tool,
    claude_glob_tool,
    claude_grep_tool,
    claude_task_create_tool,
    claude_task_get_tool,
    claude_task_update_tool,
    claude_task_list_tool,
    claude_web_fetch_tool,
    claude_web_search_tool,
    claude_task_stop_tool,
    claude_ask_user_question_tool,
    claude_workflow_tool,
    claude_wait_for_workflow_tool,
    claude_send_message_tool,
] as const;

export const claude_sonnet_tools = [
    claude_agent_tool_sonnet,
    claude_task_output_tool_sonnet,
    claude_bash_tool_sonnet,
    claude_read_tool_sonnet,
    claude_edit_tool_sonnet,
    claude_write_tool_sonnet,
    claude_glob_tool_sonnet,
    claude_grep_tool_sonnet,
    claude_task_create_tool_sonnet,
    claude_task_get_tool_sonnet,
    claude_task_update_tool_sonnet,
    claude_task_list_tool_sonnet,
    claude_web_fetch_tool_sonnet,
    claude_web_search_tool_sonnet,
    claude_task_stop_tool_sonnet,
    claude_ask_user_question_tool_sonnet,
    claude_workflow_tool_sonnet,
    claude_wait_for_workflow_tool_sonnet,
    claude_send_message_tool_sonnet,
] as const;
