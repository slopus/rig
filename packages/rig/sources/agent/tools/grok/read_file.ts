/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { describeFileAutoPermissionAction } from "../../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../../permissions/shouldReviewPathInAutoMode.js";
import { readFileReturnSchema, readTextFile } from "../../../tools/utils/index.js";
import { readToolCallPresentation } from "../../../tools/utils/createExplorationToolCallPresentation.js";

export const grokReadFileTool = defineTool({
    name: "read_file",
    label: "read_file",
    description: `Read a file.

Usage:
- target_file can be a relative path in the workspace or an absolute path.
- By default, it reads up to 1000 lines starting from the beginning of the file.
- Results are returned with line numbers starting at 1 in the format LINE_NUMBER→LINE_CONTENT.`,
    arguments: Type.Object({
        target_file: Type.String({
            description:
                "The path of the file to read. You can use a relative path in the workspace or an absolute path.",
        }),
        offset: Type.Optional(
            Type.Integer({
                description:
                    "The line number to start reading from. Only provide it if the file is too large to read at once.",
            }),
        ),
        limit: Type.Optional(
            Type.Integer({
                description:
                    "The number of lines to read. Only provide it if the file is too large to read at once.",
                minimum: 0,
            }),
        ),
    }),
    returnType: readFileReturnSchema,
    describeAutoPermissionAction: ({ target_file }, context) =>
        describeFileAutoPermissionAction(target_file, context, "reading"),
    shouldReviewInAutoMode: ({ target_file }, context) =>
        shouldReviewPathInAutoMode(target_file, context, { write: false }),
    shouldRunInFullAccessInAutoMode: ({ target_file }, context) =>
        shouldReviewPathInAutoMode(target_file, context, { write: false }),
    execute: async ({ limit, offset, target_file }, context) =>
        readTextFile(
            {
                path: target_file,
                numbered: true,
                ...(offset === undefined ? {} : { offset }),
                limit: limit ?? 1_000,
            },
            context,
        ),
    toCallPresentation: ({ target_file }, context) =>
        readToolCallPresentation(target_file, context),
    toLLM: (result) => [
        {
            type: "text",
            text:
                result.content.length === 0
                    ? "(empty file)"
                    : result.content.replace(/^(\d+)\t/gmu, "$1→"),
        },
    ],
    toUI: (result) =>
        `Read ${result.path} (${result.returnedLines}/${result.totalLines} lines${result.truncated ? ", truncated" : ""})`,
    locks: [],
});
