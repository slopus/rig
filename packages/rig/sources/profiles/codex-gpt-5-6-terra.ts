// Latest openai/codex main deviations are persisted beside this profile and under ./codex.
// Prompt changed: Codex's leading identity is replaced by a GPT-5.6 Terra Rig identity; its
// secondary "As Codex" self-reference becomes "As Rig"; all other official base-instruction
// bytes are retained. Rig appends runtime model metadata and,
// at Ultra effort, its separately persisted Ultra instructions. Tools changed: Rig keeps Codex's
// exec/wait/direct-input/collaboration split. Removed: resource-list/read helpers, plugin install,
// and send_message's message-only semantics. Added under the separate provider-neutral `rig`
// namespace: workflows, richer cross-provider agent controls, and resume_agent. Secret injection
// and richer execution results remain Rig extensions. request_user_input drops the invalid
// Plan-mode restriction. A short runtime append explains native `collaboration` versus portable
// `rig`; incompatible encrypted native follow-ups fail with corrective retry guidance. Rig also
// exposes off reasoning. The adjacent tool patch records every schema and description change.
// Model-facing audio() instructions are omitted because Rig has no audio transcript block; notify()
// instructions are omitted because notifications become UI progress. Both runtime helpers remain.
// Wire change: Rig sends standard Responses tools/instructions rather than the official Responses
// Lite additional_tools/developer-input envelope.
// Version note: Codex CLI 0.144.6 compiles an older prompt than the pinned main-source golden; the
// adjacent summary records that release-skew hash and examples. Rig follows the newer source.
import { createModelProfile } from "./impl/createModelProfile.js";
import { codexReferenceClient } from "./impl/codexReferenceClient.js";
import { gpt56TerraPromptWithUltra } from "./codex/prompt.js";
import { codexProfileTools } from "./impl/profileTools.js";
import { modelOpenaiGpt56Terra } from "../providers/models.js";

export const codexOpenaiGpt56TerraProfile = createModelProfile({
    providerType: "codex",
    vendor: "openai",
    model: modelOpenaiGpt56Terra,
    imageProfile: "codex",
    toolProfile: "codex",
    tools: codexProfileTools,
    prompt: gpt56TerraPromptWithUltra,
    wireMode: "openai-responses",
    wireModelId: "gpt-5.6-terra",
    referenceClient: codexReferenceClient("openai/gpt-5.6-terra"),
    serviceTiers: ["fast"],
});
