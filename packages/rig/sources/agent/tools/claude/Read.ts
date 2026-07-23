import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { resolveFileSystemPath } from "../../context/resolveFileSystemPath.js";
import { describeFileAutoPermissionAction } from "../../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../../permissions/shouldReviewPathInAutoMode.js";
import {
    mediaTypeForPath,
    readFileReturnSchema,
    readTextFile,
    textOutputSchema,
} from "../../../tools/utils/index.js";
import { readToolCallPresentation } from "../../../tools/utils/createExplorationToolCallPresentation.js";

const MAX_LINES_TO_READ = 2000;

// Notebook parsing is intentionally outside Rig's curated Claude tool surface.
// Reject notebooks explicitly so the tool never presents raw JSON as parsed cells or outputs.
const CLAUDE_READ_DESCRIPTION = `Reads a file from the local filesystem. Paths outside the active workspace may require permission or be blocked by the selected permission mode.
If the user provides a path to a file, assume the path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${MAX_LINES_TO_READ} lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Results are returned using cat -n format, with line numbers starting at 1
- This tool reads common image formats (for example PNG and JPG) and presents them visually.
- Jupyter notebooks (.ipynb files) are not supported. Ask the user to export the notebook to a plain-text format before reading it.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- Empty files are returned as \`(empty file)\`.`;

const claudeReadReturnSchema = Type.Union([
    readFileReturnSchema,
    Type.Object({
        image_url: Type.String(),
        mediaType: Type.String(),
    }),
    textOutputSchema,
]);

export const claudeReadTool = defineTool({
    name: "Read",
    label: "Read",
    description: CLAUDE_READ_DESCRIPTION,
    arguments: Type.Object({
        file_path: Type.String({ description: "The absolute path to the file to read" }),
        offset: Type.Optional(
            Type.Number({
                description:
                    "The line number to start reading from. Only provide if the file is too large to read at once",
            }),
        ),
        limit: Type.Optional(
            Type.Number({
                description:
                    "The number of lines to read. Only provide if the file is too large to read at once.",
            }),
        ),
    }),
    returnType: claudeReadReturnSchema,
    describeAutoPermissionAction: ({ file_path }, context) =>
        describeFileAutoPermissionAction(file_path, context, "reading"),
    shouldReviewInAutoMode: ({ file_path }, context) =>
        shouldReviewPathInAutoMode(file_path, context, { write: false }),
    shouldRunInFullAccessInAutoMode: ({ file_path }, context) =>
        shouldReviewPathInAutoMode(file_path, context, { write: false }),
    execute: async ({ file_path, offset, limit }, context) => {
        const resolvedPath = resolveFileSystemPath(file_path, context.fs.cwd, context.fs.home);
        const lower = resolvedPath.toLowerCase();
        if (lower.endsWith(".ipynb")) {
            return {
                text: "Jupyter notebooks are not supported. Export the notebook to a plain-text format first.",
            };
        }
        if (lower.endsWith(".pdf")) {
            return {
                text: "PDF rendering is not supported. Convert the PDF to text or images first.",
            };
        }
        if (/\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) {
            const mediaType = mediaTypeForPath(resolvedPath);
            const data = Buffer.from(await context.fs.readFileBuffer(resolvedPath)).toString(
                "base64",
            );
            const stats = await context.fs.stat(resolvedPath);
            context.fileReads?.recordRead(resolvedPath, stats.mtimeMs);
            return {
                image_url: `data:${mediaType};base64,${data}`,
                mediaType,
            };
        }

        const options: Parameters<typeof readTextFile>[0] = {
            limit: limit ?? MAX_LINES_TO_READ,
            path: resolvedPath,
            numbered: true,
        };
        if (offset !== undefined) options.offset = offset;
        return readTextFile(options, context);
    },
    toCallPresentation: ({ file_path }, context) => readToolCallPresentation(file_path, context),
    toLLM: (result) => {
        if ("image_url" in result) {
            const match = /^data:([^;]+);base64,(.*)$/.exec(result.image_url);
            return match
                ? [{ type: "image", mediaType: match[1] ?? result.mediaType, data: match[2] ?? "" }]
                : [{ type: "text", text: result.image_url }];
        }

        if ("content" in result) {
            return [
                { type: "text", text: result.content.length > 0 ? result.content : "(empty file)" },
            ];
        }

        return [{ type: "text", text: result.text }];
    },
    toUI: (result, args) => {
        if ("image_url" in result) {
            return `Read image ${args.file_path}`;
        }
        if ("content" in result) {
            return `Read ${result.path} (${result.returnedLines}/${result.totalLines} lines${result.truncated ? ", truncated" : ""})`;
        }
        return result.text;
    },
    locks: [],
});
