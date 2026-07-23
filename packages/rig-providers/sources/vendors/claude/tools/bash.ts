import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_bash_tool: SessionTool = {
    name: "Bash",
    type: "local",
    description:
        "Executes a bash command and returns its output.\n\n- Commands start in the session working directory. Shell state (such as `cd`, environment variables, and functions) does not persist between calls.\n- IMPORTANT: Avoid using this tool to run `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.\n- `timeout` is in milliseconds: default 120000, max 600000.\n- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. No `&` needed.\n\n# Git\n- Interactive flags (`-i`, e.g. `git rebase -i`, `git add -i`) are not supported in this environment.\n- Use the `gh` CLI for GitHub operations (PRs, issues, API).\n- Commit or push only when the user asks. If on the default branch, branch first.\n\nRig extension: `secrets` injects selected session secret bundles. `dangerouslyDisableSandbox` requests one reviewed full-access execution in Auto mode; it never bypasses Read only or Workspace write mode.",
    parameters: Type.Object(
        {
            command: Type.String({ description: "The command to execute" }),
            timeout: Type.Optional(
                Type.Number({ description: "Optional timeout in milliseconds (max 600000)" }),
            ),
            description: Type.Optional(
                Type.String({
                    description:
                        'Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.\n\nFor simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):\n- ls → "List files in current directory"\n- git status → "Show working tree status"\n- npm install → "Install package dependencies"\n\nFor commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:\n- find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"\n- git reset --hard origin/main → "Discard all local changes and match remote main"\n- curl -s url | jq \'.data[]\' → "Fetch JSON from URL and extract data array elements"',
                }),
            ),
            run_in_background: Type.Optional(
                Type.Boolean({ description: "Set to true to run this command in the background." }),
            ),
            dangerouslyDisableSandbox: Type.Optional(
                Type.Boolean({
                    description:
                        "Request reviewed execution outside the workspace sandbox in Auto mode. Use only when the sandbox blocks a necessary command.",
                }),
            ),
            secrets: Type.Optional(
                Type.Array(Type.String(), {
                    description:
                        "IDs of attached secret bundles to inject for this command. Use an empty array for none.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
};

export const claude_bash_tool_sonnet: SessionTool = {
    name: "Bash",
    type: "local",
    description:
        "Run a shell command. Output returned to Claude is truncated to the last 2000 lines or 50KB.\n\nRig extension: `secrets` injects selected session secret bundles. `dangerouslyDisableSandbox` requests one reviewed full-access execution in Auto mode; it never bypasses Read only or Workspace write mode.",
    parameters: Type.Object(
        {
            command: Type.String({ description: "The command to execute" }),
            timeout: Type.Optional(
                Type.Number({ description: "Optional timeout in milliseconds (max 600000)" }),
            ),
            description: Type.Optional(
                Type.String({
                    description:
                        'Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.\n\nFor simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):\n- ls → "List files in current directory"\n- git status → "Show working tree status"\n- npm install → "Install package dependencies"\n\nFor commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:\n- find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"\n- git reset --hard origin/main → "Discard all local changes and match remote main"\n- curl -s url | jq \'.data[]\' → "Fetch JSON from URL and extract data array elements"',
                }),
            ),
            run_in_background: Type.Optional(
                Type.Boolean({ description: "Set to true to run this command in the background." }),
            ),
            dangerouslyDisableSandbox: Type.Optional(
                Type.Boolean({
                    description:
                        "Request reviewed execution outside the workspace sandbox in Auto mode. Use only when the sandbox blocks a necessary command.",
                }),
            ),
            secrets: Type.Optional(
                Type.Array(Type.String(), {
                    description:
                        "IDs of attached secret bundles to inject for this command. Use an empty array for none.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
};
