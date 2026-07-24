import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { describeFileAutoPermissionAction } from "../../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../../permissions/shouldReviewPathInAutoMode.js";
import { globFiles, toTextBlocks } from "../../../tools/utils/index.js";
import { listToolCallPresentation } from "../../../tools/utils/createExplorationToolCallPresentation.js";

const MAX_RESULTS = 100;
const TRUNCATION_NOTICE =
    "(Results are truncated. Consider using a more specific path or pattern.)";

const claudeGlobOutputSchema = Type.Object({
    text: Type.String(),
    numFiles: Type.Number(),
    truncated: Type.Boolean(),
});

const CLAUDE_GLOB_DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`;

export const claudeGlobTool = defineTool({
    name: "Glob",
    label: "Glob",
    description: CLAUDE_GLOB_DESCRIPTION,
    arguments: Type.Object(
        {
            pattern: Type.String({ description: "The glob pattern to match files against" }),
            path: Type.Optional(
                Type.String({
                    description:
                        'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
                }),
            ),
        },
        { additionalProperties: false },
    ),
    returnType: claudeGlobOutputSchema,
    describeAutoPermissionAction: ({ path }, context) =>
        describeFileAutoPermissionAction(path ?? ".", context, "searching"),
    shouldReviewInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path ?? ".", context, { write: false }),
    shouldRunInFullAccessInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path ?? ".", context, { write: false }),
    execute: async ({ pattern, path }, context, execution) => {
        const options: Parameters<typeof globFiles>[0] = {
            pattern,
            limit: MAX_RESULTS + 1,
        };
        if (path !== undefined) options.path = path;
        if (execution.signal !== undefined) options.signal = execution.signal;
        const files = await globFiles(options, context);
        const truncated = files.length > MAX_RESULTS;
        const filenames = files.slice(0, MAX_RESULTS);
        return {
            text:
                filenames.length === 0
                    ? "No files found"
                    : [...filenames, ...(truncated ? [TRUNCATION_NOTICE] : [])].join("\n"),
            numFiles: filenames.length,
            truncated,
        };
    },
    toCallPresentation: ({ path, pattern }, context) =>
        listToolCallPresentation(path ?? ".", context, pattern),
    toLLM: toTextBlocks,
    toUI: (result, args) =>
        result.numFiles === 0
            ? `Found files for "${args.pattern}" (0)`
            : `Found files for "${args.pattern}" (${String(result.numFiles)}${result.truncated ? ", truncated" : ""})`,
    locks: [],
});
