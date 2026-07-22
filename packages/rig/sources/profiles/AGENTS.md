# Model profile principles

This directory is the source of truth for Rig's curated model profiles. Keep the catalog small,
intentional, and executable through the same provider/runtime path that production sessions use.

## Layout

- Put each model/vendor profile at this directory's top level as `<vendor>-<model>.ts`.
- One profile represents one model plus one vendor. Do not split profiles by transport, hosting
  route, or credential source.
- Do not introduce multiple profiles when models have the same identity and runtime behavior. Use
  model routing or profile variants when only transport parameters differ.
- Put vendor-specific prompt capture, transformation, patches, append instructions, generators,
  and tests in the matching vendor subdirectory.
- Put the human-readable `<vendor>-<model>.md` summary beside its top-level profile.

## Official prompts

- Extract the official prompt from the latest pinned official client source. Do not reconstruct it
  from memory, documentation, a previous Rig prompt, or an inference response when source code is
  available.
- Persist source revision metadata and fail closed when the expected source shape changes.
- Keep the official `<stem>.golden.md`, Rig-computed `<stem>.md`, and `<stem>.patch` adjacent in the
  vendor directory. The computed prompt used at runtime must be the persisted `<stem>.md` file.
- Put Rig's identity first. Retain the official prompt byte-for-byte wherever it remains accurate.
  Remove or change only instructions that contradict Rig's actual harness, tools, permissions, or
  product behavior.
- Describe every addition, removal, and adaptation in comments at the top of the model profile and
  in its human-readable summary. Do not add a runtime deviations structure.
- Persist dynamic sections as explicit templates or appends and test their rendering. Do not replace
  a full official prompt with a one-line placeholder.
- Preserve captured whitespace and generated patch bytes. Exclude generated artifacts from source
  formatting instead of reformatting upstream text.

## Official tools

- Preserve official tool names, descriptions, and input schemas exactly when Rig implements the
  same behavior.
- Remove tools Rig cannot execute honestly. Add Rig-only tools and fields only for real features,
  such as secret injection, and document each difference in profile comments and summaries.
- Treat persisted computed tool definitions as the model-facing source of truth. Hydrate those
  definitions onto real executable Rig tools and test both schema validation and runtime behavior.
- Never add Rig extensions to a provider-reserved namespace. Preserve the native namespace exactly
  and expose portable Rig additions through a separate `rig` namespace when the transport supports
  namespaces; both surfaces must dispatch through the same canonical tools and permission path.
- Determine native encrypted collaboration support from the model/transport capability and its
  provider/region scope. Amazon Bedrock Mantle supports Codex v2 namespace and encrypted-message
  schemas within one Bedrock provider and region; ciphertext must not cross provider instances,
  Codex Cloud/Bedrock boundaries, or Bedrock regions.
- Portable agent tools must reject native ciphertext fields. Persist every delegated prompt and
  follow-up as model-authored agent provenance so it can never become user authorization evidence.
- Provider-shaped schemas and guidance must still execute through Rig's shared `AgentContext`,
  permission model, filesystem boundary, and shell sandbox.

## Verification

- Generated artifacts must have a deterministic write mode and a check mode that detects stale
  files without rewriting them.
- Lock source commits or package versions and prompt hashes in tests so client upgrades are
  deliberate.
- Test golden extraction, exact transformation, patch reproduction, runtime prompt/tool loading,
  dynamic rendering, and built-package asset copying.
- Keep generated artifacts beside one another for GitHub review, and embed complete readable diffs
  in the top-level Markdown summary.
- Update the curated model catalog directly. Do not add discovery calls, compatibility aliases, or
  startup migrations for obsolete profiles.
