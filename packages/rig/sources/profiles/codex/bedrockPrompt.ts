import type { ProfilePrompt } from "../impl/types.js";
import { readCodexProfilePrompt } from "./readCodexProfileArtifact.js";

export const codexBedrockPrompt: ProfilePrompt = {
    original: {
        text: readCodexProfilePrompt("codex-bedrock-gpt-5-5"),
        provenance: {
            client: "Codex CLI",
            version: "0.145.0",
            source: "codex-rs/models-manager/models.json at d4fcb2873bf23464cfacd804a31d46529db943b0, rendered with the official pragmatic personality template",
            captureMethod:
                "Verified source rendering against the first Bedrock Responses request emitted by Codex CLI 0.145.0",
            clientTools: [
                "exec_command",
                "write_stdin",
                "update_plan",
                "request_user_input",
                "apply_patch",
                "view_image",
                "tool_search",
            ],
        },
    },
    patches: [],
    appends: [],
};
