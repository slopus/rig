import type { AgentContext } from "./context/AgentContext.js";
import { escapeXml } from "./skills/escapeXml.js";

export function createCodexBedrockEnvironmentContext(context: AgentContext): string {
    const currentDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    const permissionMode = context.permissions?.mode ?? "full_access";
    const cwd = escapeXml(context.fs.cwd);
    const shell = escapeXml(process.env.SHELL ?? "zsh");
    const date = escapeXml(currentDate);
    const timezone = escapeXml(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const fileSystem =
        permissionMode === "full_access"
            ? '<permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile>'
            : permissionMode === "read_only"
              ? '<permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry></file_system></permission_profile>'
              : `<permission_profile type="managed"><file_system type="restricted"><entry access="write"><path>${cwd}</path></entry></file_system></permission_profile>`;
    return [
        "<environment_context>",
        `  <cwd>${cwd}</cwd>`,
        `  <shell>${shell}</shell>`,
        `  <current_date>${date}</current_date>`,
        `  <timezone>${timezone}</timezone>`,
        `  <filesystem><workspace_roots><root>${cwd}</root></workspace_roots>${fileSystem}</filesystem>`,
        "</environment_context>",
    ].join("\n");
}
