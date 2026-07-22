# Codex prompt patches

The Codex prompt transformation currently replaces only the exact official identity line
with the model-specific Rig identity and fails closed if that source line changes. The
generated unified diffs live beside their corresponding golden and computed prompts as
`codex-gpt-5-6-*.patch` in the parent folder.

Put future reusable named transformations in this folder. Keep every transformation exact,
document its deviation in the top-level model profile comment, and regenerate the adjacent
golden, computed, patch, and human-readable summary artifacts together.
