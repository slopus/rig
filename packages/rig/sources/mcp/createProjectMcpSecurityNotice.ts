import type { McpServerConfigEntry } from "./types.js";

export function createProjectMcpSecurityNotice(
    entries: readonly McpServerConfigEntry[],
): string | undefined {
    const hasProjectServer = entries.some((entry) => entry.source === "project");
    const hasShadowedProjectServer = entries.some((entry) => entry.projectShadowed === true);
    if (!hasProjectServer && !hasShadowedProjectServer) return undefined;

    return [
        ...(hasProjectServer
            ? [
                  "MCP server settings from this project need one-time trust before they start. Rig saves the decision and asks again if the server configuration changes.",
              ]
            : []),
        ...(hasShadowedProjectServer
            ? [
                  "Your user-level MCP server takes precedence over a project server with the same name.",
              ]
            : []),
    ].join(" ");
}
