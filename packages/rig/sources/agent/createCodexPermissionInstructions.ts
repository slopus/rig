import type { PermissionMode } from "../permissions/index.js";

export function createCodexPermissionInstructions(mode: PermissionMode): string {
    const sandbox =
        mode === "full_access"
            ? "Filesystem sandboxing defines which files can be read or written. `sandbox_mode` is `danger-full-access`: No filesystem sandboxing - all commands are permitted. Network access is enabled."
            : mode === "read_only"
              ? "Filesystem sandboxing defines which files can be read or written. `sandbox_mode` is `read-only`: The sandbox only permits reading files. Network access is restricted."
              : "Filesystem sandboxing defines which files can be read or written. `sandbox_mode` is `workspace-write`: The sandbox permits reading files, and editing files in `cwd` and `writable_roots`. Editing files in other directories requires approval. Network access is restricted.";
    const approval =
        mode === "auto"
            ? "`approvals_reviewer` is `auto_review`: Sandbox escalations with require_escalated will be reviewed for compliance with the policy. If a rejection happens, you should proceed only with a materially safer alternative, or inform the user of the risk and send a final message to ask for approval."
            : "Approval policy is currently never. Do not provide the `sandbox_permissions` for any reason, commands will be rejected.";
    return `<permissions instructions>\n${sandbox}\n${approval}\n</permissions instructions>`;
}
