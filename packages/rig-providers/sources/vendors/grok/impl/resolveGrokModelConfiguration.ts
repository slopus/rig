import type { SessionContext } from "@/core/SessionContext.js";
import type { SessionModelConfiguration } from "@/core/SessionModelConfiguration.js";
import type { SessionSkill } from "@/core/SessionSkill.js";
import type { SessionTool } from "@/core/SessionTool.js";

export function resolveGrokModelConfiguration(options: {
    context: SessionContext;
    defaultSkills: readonly SessionSkill[];
    defaultTools: readonly SessionTool[];
    modelConfiguration?: SessionModelConfiguration;
}): { context: SessionContext; tools: readonly SessionTool[] } {
    const configuration = options.modelConfiguration;
    const skills = configuration?.skills ?? options.defaultSkills;
    const skillPrompt =
        skills.length === 0
            ? ""
            : `<skills>\n${skills
                  .map(
                      (skill) =>
                          `<skill name="${skill.name}" source="${skill.source}" location="${skill.location}">${skill.description}</skill>`,
                  )
                  .join("\n")}\n</skills>`;
    return {
        context: {
            instructions: [
                configuration?.context.instructions ?? options.context.instructions,
                skillPrompt,
            ]
                .filter(Boolean)
                .join("\n\n"),
            messages: [
                ...(configuration?.context.messages.filter(
                    (message) => message.role === "system",
                ) ?? []),
                ...options.context.messages,
            ],
        },
        tools: configuration?.tools ?? options.defaultTools,
    };
}
