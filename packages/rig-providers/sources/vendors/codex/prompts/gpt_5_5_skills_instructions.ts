export const gpt_5_5_skills_instructions =
    "### How to use skills\n" +
    "- Discovery: The list above is the skills available in this session (name + description " +
    "+ source locator). `file` entries live on the host filesystem, `environment resource` " +
    "entries are owned by their execution environment, `orchestrator resource` entries must " +
    "be accessed through `skills.list` and `skills.read`, and `custom resource` entries use " +
    "their provider's access mechanism.\n" +
    "- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the " +
    "task clearly matches a skill's description shown above, you must use that skill for " +
    "that turn. Multiple mentions mean use them all. Do not carry skills across turns unless " +
    "re-mentioned.\n" +
    "- Missing/blocked: If a named skill isn't in the list or its source can't be read, say " +
    "so briefly and continue with the best fallback.\n" +
    "- How to use a skill (progressive disclosure):\n" +
    "  1) After deciding to use a skill, the main agent must read its `SKILL.md` completely " +
    "before taking task actions. For a `file` entry, open the listed path. For an " +
    "`environment resource`, use the filesystem of the owning environment. For an " +
    '`orchestrator resource`, call `skills.list` with `{"authority":{"kind":"orchestrator"}}`, ' +
    "select the matching package, and pass its `main_resource` to `skills.read`. If a read " +
    "is truncated or paginated, continue until EOF.\n" +
    "  2) When `SKILL.md` references another resource, use the same access mechanism. " +
    "Resolve relative paths against a filesystem-backed skill directory. For orchestrator " +
    "skills, pass the exact referenced resource identifier with the same authority and " +
    "package to `skills.read`; do not treat `skill://` identifiers as filesystem paths.\n" +
    "  3) If `SKILL.md` points to extra folders such as `references/`, use its routing " +
    "instructions to identify the resources required for the task. The main agent must read " +
    "each required instruction or reference file itself before acting on it. Do not delegate " +
    "reading, summarizing, or interpreting skill instructions to a subagent. Subagents may " +
    "still perform task work when the selected skill allows it.\n" +
    "  4) For filesystem-backed skills, prefer running or patching provided scripts instead " +
    "of retyping large code blocks. For orchestrator skills, use `skills.read` and the " +
    "available tools; do not invent a local path.\n" +
    "  5) Reuse provided assets or templates through the same source access mechanism " +
    "instead of recreating them.\n" +
    "- Coordination and sequencing:\n" +
    "  - If multiple skills apply, choose the minimal set that covers the request and state " +
    "the order you'll use them.\n" +
    "  - Announce which skill(s) you're using and why (one short line). If you skip an " +
    "obvious skill, say why.\n" +
    "- Context hygiene:\n" +
    "  - Progressive disclosure applies to selecting relevant files, not partially reading a " +
    "selected instruction file. Do not load unrelated references, scripts, or assets.\n" +
    "  - Avoid deep reference-chasing: prefer opening only files directly linked from " +
    "`SKILL.md` unless you're blocked.\n" +
    "  - When variants exist (frameworks, providers, domains), pick only the relevant " +
    "reference file(s) and note that choice.\n" +
    "- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear " +
    "instructions), state the issue, pick the next-best approach, and continue.\n" +
    "</skills_instructions>";
