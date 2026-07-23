/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { resolveFileSystemPath } from "../../context/resolveFileSystemPath.js";
import { describeFileAutoPermissionAction } from "../../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../../permissions/shouldReviewPathInAutoMode.js";
import { countTextLines, textOutputSchema, toTextBlocks } from "../../../tools/utils/index.js";
import { formatDirectoryEntryName } from "../../../tools/utils/formatDirectoryEntryName.js";
import { listToolCallPresentation } from "../../../tools/utils/createExplorationToolCallPresentation.js";

const MAX_ENTRIES = 500;

export const grokListDirTool = defineTool({
    name: "list_dir",
    label: "list_dir",
    description: `Lists files and directories in a given path. The target_directory parameter can be relative to the workspace root or absolute.

Other details:
- The result does not display dot-files and dot-directories.
- Large directories are truncated; use list_dir on a narrower path or grep to explore further.`,
    arguments: Type.Object({
        target_directory: Type.String({
            description:
                "Path to the directory to list, relative to the workspace root or absolute.",
        }),
    }),
    returnType: textOutputSchema,
    describeAutoPermissionAction: ({ target_directory }, context) =>
        describeFileAutoPermissionAction(target_directory, context, "listing"),
    shouldReviewInAutoMode: ({ target_directory }, context) =>
        shouldReviewPathInAutoMode(target_directory, context, { write: false }),
    shouldRunInFullAccessInAutoMode: ({ target_directory }, context) =>
        shouldReviewPathInAutoMode(target_directory, context, { write: false }),
    execute: async ({ target_directory }, context) => {
        const path = resolveFileSystemPath(target_directory, context.fs.cwd, context.fs.home);
        const entries = (await context.fs.readdir(path))
            .filter((entry) => !entry.startsWith("."))
            .sort((left, right) => left.localeCompare(right));
        const output: string[] = [];
        for (const entry of entries.slice(0, MAX_ENTRIES)) {
            output.push(await formatDirectoryEntryName(entry, path, context));
        }
        if (entries.length > MAX_ENTRIES) output.push("... (directory listing truncated)");
        return { text: output.length === 0 ? "(empty directory)" : output.join("\n") };
    },
    toCallPresentation: ({ target_directory }, context) =>
        listToolCallPresentation(target_directory, context),
    toLLM: toTextBlocks,
    toUI: (result, args) =>
        result.text === "(empty directory)"
            ? `Listed ${args.target_directory} (empty)`
            : `Listed ${args.target_directory} (${countTextLines(result.text)} entries)`,
    locks: [],
});
