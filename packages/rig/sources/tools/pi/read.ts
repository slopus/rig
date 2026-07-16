import { Type } from "@sinclair/typebox";

import { resolveFileSystemPath } from "../../agent/context/resolveFileSystemPath.js";
import { defineTool } from "../../agent/types.js";
import { shouldReviewPathInAutoMode } from "../../permissions/shouldReviewPathInAutoMode.js";
import { mediaTypeForPath, readFileReturnSchema, readTextFile } from "../utils/index.js";
import { boundPiReadResult } from "./boundPiReadResult.js";

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;
const MAX_IMAGE_BYTES = (5 * 1024 * 1024 * 3) / 4;

const piReadReturnSchema = Type.Union([
    readFileReturnSchema,
    Type.Object({
        image_url: Type.String(),
        mediaType: Type.String(),
    }),
]);

export const piReadTool = defineTool({
    name: "read",
    label: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images up to 3.75MB are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    arguments: Type.Object({
        path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
        offset: Type.Optional(
            Type.Number({ description: "Line number to start reading from (1-indexed)" }),
        ),
        limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
    }),
    returnType: piReadReturnSchema,
    shouldReviewInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path, context, { write: false }),
    shouldRunInFullAccessInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path, context, { write: false }),
    execute: async ({ path, offset, limit }, context) => {
        const resolvedPath = resolveFileSystemPath(path, context.fs.cwd, context.fs.home);
        if (/\.(png|jpe?g|gif|webp)$/iu.test(resolvedPath)) {
            const stats = await context.fs.stat(resolvedPath);
            if (stats.size > MAX_IMAGE_BYTES) {
                throw new Error(`Image exceeds the supported 3.75MB size limit: ${path}`);
            }
            const mediaType = mediaTypeForPath(resolvedPath);
            const data = Buffer.from(await context.fs.readFileBuffer(resolvedPath)).toString(
                "base64",
            );
            context.fileReads?.recordRead(resolvedPath, stats.mtimeMs);
            return {
                image_url: `data:${mediaType};base64,${data}`,
                mediaType,
            };
        }

        const effectiveLimit = Math.min(limit ?? DEFAULT_MAX_LINES, DEFAULT_MAX_LINES);
        const options: Parameters<typeof readTextFile>[0] = {
            limit: effectiveLimit,
            path: resolvedPath,
        };
        if (offset !== undefined) options.offset = offset;
        const result = await readTextFile(options, context);
        return boundPiReadResult(result, {
            includeContinuationNotice:
                result.truncated && (limit === undefined || limit >= DEFAULT_MAX_LINES),
            maxBytes: DEFAULT_MAX_BYTES,
            maxLines: DEFAULT_MAX_LINES,
        });
    },
    toLLM: (result) => {
        if ("image_url" in result) {
            const match = /^data:([^;]+);base64,(.*)$/u.exec(result.image_url);
            return match
                ? [{ type: "image", mediaType: match[1] ?? result.mediaType, data: match[2] ?? "" }]
                : [{ type: "text", text: result.image_url }];
        }

        return [
            {
                type: "text",
                text: result.content.length > 0 ? result.content : "(empty file)",
            },
        ];
    },
    toUI: (result, args) =>
        "image_url" in result
            ? `Read image ${args.path}`
            : `Read ${result.path} (${result.returnedLines}/${result.totalLines} lines${result.truncated ? ", truncated" : ""})`,
    locks: [],
});
