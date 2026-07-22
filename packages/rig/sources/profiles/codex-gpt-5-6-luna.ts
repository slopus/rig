// Latest openai/codex main deviations are persisted beside this profile and under ./codex.
// Prompt changed: Codex's leading identity is replaced by a GPT-5.6 Luna Rig identity; its
// secondary "As Codex" self-reference becomes "As Rig"; all other official base-instruction
// bytes are retained. Rig appends runtime model metadata.
// Tools changed: Rig keeps Codex's exec/wait/direct-input split. Removed: resource-list/read
// helpers and plugin install. Added: secret injection, Rig result fields, and direct workflow/
// collaboration tools when configured. request_user_input drops the invalid Plan-mode restriction.
// Rig also exposes off reasoning. The adjacent tool patch records every definition change.
// Model-facing audio() instructions are omitted because Rig has no audio transcript block; notify()
// instructions are omitted because notifications become UI progress. Both runtime helpers remain.
// Wire change: Rig sends standard Responses tools/instructions rather than the official Responses
// Lite additional_tools/developer-input envelope.
// Version note: Codex CLI 0.144.6 compiles an older prompt than the pinned main-source golden; the
// adjacent summary records that release-skew hash and examples. Rig follows the newer source.
import { createModelProfile } from "./impl/createModelProfile.js";
import { codexReferenceClient } from "./impl/codexReferenceClient.js";
import { gpt56LunaPrompt } from "./codex/prompt.js";
import { codexProfileTools } from "./impl/profileTools.js";
import { modelOpenaiGpt56Luna } from "../providers/models.js";

export const codexOpenaiGpt56LunaProfile = createModelProfile({
    providerType: "codex",
    vendor: "openai",
    model: modelOpenaiGpt56Luna,
    imageProfile: "codex",
    toolProfile: "codex",
    tools: codexProfileTools,
    prompt: gpt56LunaPrompt,
    wireMode: "openai-responses",
    wireModelId: "gpt-5.6-luna",
    referenceClient: codexReferenceClient("openai/gpt-5.6-luna"),
    serviceTiers: ["fast"],
});
