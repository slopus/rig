import { Type } from "@sinclair/typebox";

import { defineTool, type AnyDefinedTool } from "../agent/types.js";
import { externalToolResolutionToContent } from "../external-tools/externalToolResolutionToContent.js";
import type { ExternalToolCallResolution } from "../external-tools/types.js";
import type { DurableSkillDefinition } from "./types.js";

export function createDurableSkillTool(options: {
    skills: readonly DurableSkillDefinition[];
    invoke: (
        skill: DurableSkillDefinition,
        request: {
            arguments: unknown;
            batchId: string;
            toolCallId: string;
            toolCallIndex: number;
        },
        signal?: AbortSignal,
    ) => Promise<ExternalToolCallResolution>;
}): AnyDefinedTool {
    const skillsByName = new Map(options.skills.map((skill) => [skill.name, skill]));
    return defineTool({
        arguments: Type.Object(
            { name: Type.String({ description: "Exact name of the durable skill to read." }) },
            { additionalProperties: false },
        ),
        description:
            "Request the complete SKILL.md contents for one configured durable skill. Use the exact skill name from the available skills catalog.",
        execution: "durable",
        label: "Read skill",
        name: "read_skill",
        returnType: Type.Unknown(),
        requiresAutoOrFullAccess: true,
        describeAutoPermissionAction: (args) =>
            `request the ${JSON.stringify(args.name)} skill from an external integration outside Rig's sandbox`,
        shouldReviewInAutoMode: () => true,
        async execute(args, _context, execution) {
            const skill = skillsByName.get(args.name);
            if (skill === undefined) {
                return {
                    error: { message: `Durable skill '${args.name}' is not configured.` },
                    status: "failed",
                } satisfies ExternalToolCallResolution;
            }
            if (
                execution.toolCallId === undefined ||
                execution.toolBatchId === undefined ||
                execution.toolCallIndex === undefined
            ) {
                throw new Error("Durable skill execution identity is missing.");
            }
            return options.invoke(
                skill,
                {
                    arguments: args,
                    batchId: execution.toolBatchId,
                    toolCallId: execution.toolCallId,
                    toolCallIndex: execution.toolCallIndex,
                },
                execution.signal,
            );
        },
        isError: (result) =>
            (result as ExternalToolCallResolution | undefined)?.status === "failed",
        toLLM: (result) => externalToolResolutionToContent(result as ExternalToolCallResolution),
        toUI: (result, args) =>
            (result as ExternalToolCallResolution).status === "failed"
                ? `Skill ${args.name} could not be read`
                : `Skill ${args.name} read`,
        interruptionMessage: "The durable skill request was interrupted.",
        locks: [],
    }) as AnyDefinedTool;
}
