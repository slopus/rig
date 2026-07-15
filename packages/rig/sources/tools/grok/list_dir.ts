/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { countTextLines, resolveToolPath, textOutputSchema, toTextBlocks } from "../utils/index.js";

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
    execute: async ({ target_directory }, context) => {
        const path = resolveToolPath(target_directory, context.fs.cwd);
        const entries = (await context.fs.readdir(path))
            .filter((entry) => !entry.startsWith("."))
            .sort((left, right) => left.localeCompare(right));
        const output: string[] = [];
        for (const entry of entries.slice(0, MAX_ENTRIES)) {
            const stats = await context.fs.stat(resolveToolPath(entry, path));
            output.push(stats.isDirectory ? `${entry}/` : entry);
        }
        if (entries.length > MAX_ENTRIES) output.push("... (directory listing truncated)");
        return { text: output.length === 0 ? "(empty directory)" : output.join("\n") };
    },
    toLLM: toTextBlocks,
    toUI: (result, args) =>
        result.text === "(empty directory)"
            ? `Listed ${args.target_directory} (empty)`
            : `Listed ${args.target_directory} (${countTextLines(result.text)} entries)`,
    locks: [],
});
