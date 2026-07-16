import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { describeFileAutoPermissionAction } from "../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../permissions/shouldReviewPathInAutoMode.js";
import { writeFileReturnSchema, writeTextFile } from "../utils/index.js";

export const piWriteTool = defineTool({
    name: "write",
    label: "write",
    description:
        "Write content to a file. Creates the file if it doesn't exist and automatically creates parent directories. Before overwriting an existing file, use the read tool in the same session. The write will fail if the file has not been read or has changed since it was read.",
    arguments: Type.Object({
        path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
        content: Type.String({ description: "Content to write to the file" }),
    }),
    returnType: writeFileReturnSchema,
    describeAutoPermissionAction: ({ path }, context) =>
        describeFileAutoPermissionAction(path, context, "writing"),
    shouldReviewInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path, context, { write: true }),
    shouldRunInFullAccessInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path, context, { write: true }),
    execute: async ({ path, content }, context) => writeTextFile({ path, content }, context),
    toLLM: (result) => [
        {
            type: "text",
            text: `Successfully wrote ${result.bytes} bytes to ${result.path}`,
        },
    ],
    toUI: (result) => `Wrote ${result.path} (${result.bytes} bytes)`,
    locks: [(args) => args.path],
});
