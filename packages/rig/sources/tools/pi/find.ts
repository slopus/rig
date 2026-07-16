import { relative, sep } from "node:path";
import { Type } from "@sinclair/typebox";

import { resolveFileSystemPath } from "../../agent/context/resolveFileSystemPath.js";
import { defineTool } from "../../agent/types.js";
import { shouldReviewPathInAutoMode } from "../../permissions/shouldReviewPathInAutoMode.js";
import {
    countTextLines,
    globFiles,
    textOutputSchema,
    toTextBlocks,
    truncateTextHead,
} from "../utils/index.js";

const DEFAULT_LIMIT = 1000;
const DEFAULT_MAX_BYTES = 50 * 1024;

export const piFindTool = defineTool({
    name: "find",
    label: "find",
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    arguments: Type.Object({
        pattern: Type.String({
            description:
                "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
        }),
        path: Type.Optional(
            Type.String({ description: "Directory to search in (default: current directory)" }),
        ),
        limit: Type.Optional(
            Type.Number({ description: "Maximum number of results (default: 1000)" }),
        ),
    }),
    returnType: textOutputSchema,
    shouldReviewInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path ?? ".", context, { write: false }),
    shouldRunInFullAccessInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path ?? ".", context, { write: false }),
    execute: async ({ pattern, path, limit }, context, execution) => {
        const effectiveLimit = limit ?? DEFAULT_LIMIT;
        const options: Parameters<typeof globFiles>[0] = {
            pattern,
            limit: effectiveLimit,
            respectGitIgnore: true,
        };
        if (path !== undefined) options.path = path;
        if (execution.signal !== undefined) options.signal = execution.signal;
        const files = await globFiles(options, context);
        if (files.length === 0) return { text: "No files found matching pattern" };

        const root = resolveFileSystemPath(path ?? ".", context.fs.cwd, context.fs.home);
        const output = files.map((file) => relative(root, file).split(sep).join("/")).join("\n");
        const truncation = truncateTextHead(output, {
            maxBytes: DEFAULT_MAX_BYTES,
            maxLines: Number.MAX_SAFE_INTEGER,
        });
        const notices: string[] = [];
        if (files.length >= effectiveLimit) notices.push(`${effectiveLimit} results limit reached`);
        if (truncation.truncated) notices.push(`${DEFAULT_MAX_BYTES / 1024}KB limit reached`);
        return {
            text:
                notices.length === 0
                    ? truncation.content
                    : `${truncation.content}\n\n[${notices.join(". ")}]`,
        };
    },
    toLLM: toTextBlocks,
    toUI: (result, args) =>
        result.text === "No files found matching pattern"
            ? `Found files for "${args.pattern}" (0)`
            : `Found files for "${args.pattern}" (${countTextLines(result.text)})`,
    locks: [],
});
