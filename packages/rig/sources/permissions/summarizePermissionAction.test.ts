import { describe, expect, it } from "vitest";

import { summarizePermissionAction } from "./summarizePermissionAction.js";

describe("summarizePermissionAction", () => {
    it("keeps the complete command visible while escaping control characters", () => {
        const command = `printf start
${"x".repeat(140)}
printf VISIBLE_COMMAND_SUFFIX`;

        const action = summarizePermissionAction("exec_command", { cmd: command });

        expect(action).toBe(
            `running "printf start\\n${"x".repeat(140)}\\nprintf VISIBLE_COMMAND_SUFFIX"`,
        );
        expect(action).not.toContain("…");
    });

    it("discloses the execution boundary for an escalated command", () => {
        const action = summarizePermissionAction(
            "exec_command",
            {
                cmd: "printf safe",
                sandbox_permissions: "require_escalated",
                shell: "/bin/sh",
                workdir: "/home/rig",
            },
            "/workspace",
        );

        expect(action).toBe(
            'running "printf safe". Working directory: "/home/rig". Shell: "/bin/sh". Access: unrestricted filesystem and network access',
        );
        expect(action).not.toContain("sandbox_permissions");
        expect(action).not.toContain("require_escalated");
    });

    it("names the effective directory and default shell when escalation omits overrides", () => {
        const action = summarizePermissionAction(
            "exec_command",
            { cmd: "printf safe", sandbox_permissions: "require_escalated" },
            "/workspace/project",
        );

        expect(action).toContain('Working directory: "/workspace/project"');
        expect(action).toContain('Shell: "the default shell"');
        expect(action).toContain("Access: unrestricted filesystem and network access");
    });

    it("renders bidi and terminal control input as visible escapes", () => {
        expect(
            summarizePermissionAction("write_stdin", {
                chars: "safe\u0003\u202emasked\n",
                session_id: 9,
            }),
        ).toBe('sending "safe\\u{0003}\\u{202e}masked\\n" to shell session 9');
    });

    it("discloses exact input and the destination shell session", () => {
        const action = summarizePermissionAction("write_stdin", {
            chars: "printf 'new action' > /tmp/proof\n",
            session_id: 42,
        });

        expect(action).toBe(`sending "printf 'new action' > /tmp/proof\\n" to shell session 42`);
    });

    it("discloses the server, operation, arguments, and unsandboxed MCP boundary", () => {
        expect(
            summarizePermissionAction("mcp__Deployment_Service__publish_release", {
                channel: "production",
                version: "1.2.3",
            }),
        ).toBe(
            'calling "publish release" from "Deployment Service" with arguments "{\\"channel\\":\\"production\\",\\"version\\":\\"1.2.3\\"}". Access: the MCP server can perform actions outside Rig’s filesystem sandbox',
        );
        expect(
            summarizePermissionAction("call_mcp_tool", {
                arguments: { channel: "production" },
                name: "publish_release",
                server: "Deployment Service",
            }),
        ).toBe(
            'calling "publish_release" from "Deployment Service" with arguments "{\\"channel\\":\\"production\\"}". Access: the MCP server can perform actions outside Rig’s filesystem sandbox',
        );
    });

    it("renders MCP control and bidi input as visible escapes", () => {
        const action = summarizePermissionAction("call_mcp_tool", {
            arguments: { value: "safe\u0007\u202emasked" },
            name: "publish\nrelease",
            server: "Deployment\u001bService",
        });

        expect(action).toContain('calling "publish\\nrelease"');
        expect(action).toContain('from "Deployment\\u{001b}Service"');
        expect(action).toContain("safe\\\\u0007\\u{202e}masked");
        expect(action).not.toContain("\u001b");
        expect(action).not.toContain("\u202e");
    });
});
