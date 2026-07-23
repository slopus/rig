import type { SessionTool } from "@/core/SessionTool.js";
import { apply_patch } from "@/vendors/codex/tools/apply_patch.js";
import { exec } from "@/vendors/codex/tools/exec.js";
import { exec_command } from "@/vendors/codex/tools/exec_command.js";
import { followup_task } from "@/vendors/codex/tools/followup_task.js";
import { imagegen } from "@/vendors/codex/tools/imagegen.js";
import { interrupt_agent } from "@/vendors/codex/tools/interrupt_agent.js";
import { list_agents } from "@/vendors/codex/tools/list_agents.js";
import { list_mcp_resource_templates } from "@/vendors/codex/tools/list_mcp_resource_templates.js";
import { list_mcp_resources } from "@/vendors/codex/tools/list_mcp_resources.js";
import { read_mcp_resource } from "@/vendors/codex/tools/read_mcp_resource.js";
import { request_plugin_install } from "@/vendors/codex/tools/request_plugin_install.js";
import { request_user_input } from "@/vendors/codex/tools/request_user_input.js";
import { send_message } from "@/vendors/codex/tools/send_message.js";
import { spawn_agent } from "@/vendors/codex/tools/spawn_agent.js";
import { tool_search } from "@/vendors/codex/tools/tool_search.js";
import { update_plan } from "@/vendors/codex/tools/update_plan.js";
import { view_image } from "@/vendors/codex/tools/view_image.js";
import { wait } from "@/vendors/codex/tools/wait.js";
import { wait_agent } from "@/vendors/codex/tools/wait_agent.js";
import { web_search } from "@/vendors/codex/tools/web_search.js";
import { write_stdin } from "@/vendors/codex/tools/write_stdin.js";

const definitions: Readonly<Record<string, readonly SessionTool[]>> = {
    "gpt-5.5": [
        exec_command,
        write_stdin,
        list_mcp_resources,
        list_mcp_resource_templates,
        read_mcp_resource,
        update_plan,
        request_user_input,
        request_plugin_install,
        apply_patch,
        view_image,
        imagegen,
        tool_search,
        web_search,
    ],
    "gpt-5.6-sol": [
        exec,
        wait,
        request_user_input,
        followup_task,
        interrupt_agent,
        list_agents,
        send_message,
        spawn_agent,
        wait_agent,
    ],
    "gpt-5.6-terra": [
        exec,
        wait,
        request_user_input,
        followup_task,
        interrupt_agent,
        list_agents,
        send_message,
        spawn_agent,
        wait_agent,
    ],
    "gpt-5.6-luna": [exec, wait, request_user_input],
};

export function codexCliTools(model: string): readonly SessionTool[] {
    const tools = definitions[model];
    if (tools === undefined) throw new Error(`No captured tools for '${model}'.`);
    return tools;
}
