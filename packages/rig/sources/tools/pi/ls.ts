import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { resolveFileSystemPath } from "../../agent/context/resolveFileSystemPath.js";
import { describeFileAutoPermissionAction } from "../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../permissions/shouldReviewPathInAutoMode.js";
import { toTextBlocks } from "../utils/index.js";
import { formatDirectoryEntryName } from "../utils/formatDirectoryEntryName.js";
import { boundDirectoryListing } from "./boundDirectoryListing.js";

const DEFAULT_LIMIT = 500;
const DEFAULT_MAX_BYTES = 50 * 1024;
const lsOutputSchema = Type.Object({
    text: Type.String(),
    numEntries: Type.Integer({ minimum: 0 }),
    truncated: Type.Boolean(),
});

export const piLsTool = defineTool({
    name: "ls",
    label: "ls",
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    arguments: Type.Object({
        path: Type.Optional(
            Type.String({ description: "Directory to list (default: current directory)" }),
        ),
        limit: Type.Optional(
            Type.Integer({
                description: "Maximum number of entries to return (default: 500)",
                minimum: 0,
            }),
        ),
    }),
    returnType: lsOutputSchema,
    describeAutoPermissionAction: ({ path }, context) =>
        describeFileAutoPermissionAction(path ?? ".", context, "listing"),
    shouldReviewInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path ?? ".", context, { write: false }),
    shouldRunInFullAccessInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path ?? ".", context, { write: false }),
    execute: async ({ path, limit }, context) => {
        const dirPath = resolveFileSystemPath(path || ".", context.fs.cwd, context.fs.home);
        const entries = [...(await context.fs.readdir(dirPath))];
        entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        if (entries.length === 0) {
            return { numEntries: 0, text: "(empty directory)", truncated: false };
        }
        const output: string[] = [];
        for (const entry of entries.slice(0, limit ?? DEFAULT_LIMIT)) {
            output.push(await formatDirectoryEntryName(entry, dirPath, context));
        }
        const bounded = boundDirectoryListing(output, entries.length, DEFAULT_MAX_BYTES);
        return {
            numEntries: bounded.entries.length,
            text: bounded.text,
            truncated: bounded.truncated,
        };
    },
    toLLM: toTextBlocks,
    toUI: (result, args) =>
        result.text === "(empty directory)"
            ? `Listed ${args.path ?? "."} (empty)`
            : `Listed ${args.path ?? "."} (${result.numEntries} ${result.numEntries === 1 ? "entry" : "entries"}${result.truncated ? "; truncated" : ""})`,
    locks: [],
});
