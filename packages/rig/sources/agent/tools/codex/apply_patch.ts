import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { shouldReviewPatchInAutoMode } from "../../../permissions/shouldReviewPatchInAutoMode.js";
import { applyPatchText } from "../../../tools/utils/index.js";
import { resolveFileSystemPath } from "../../context/resolveFileSystemPath.js";
import { describeApplyPatchAutoPermissionAction } from "./impl/describeApplyPatchAutoPermissionAction.js";

const fileDiffLineSchema = Type.Object({
    kind: Type.Union([Type.Literal("add"), Type.Literal("context"), Type.Literal("delete")]),
    text: Type.String(),
});

const fileDiffSchema = Type.Object({
    added: Type.Optional(Type.Number()),
    deleted: Type.Optional(Type.Number()),
    hunks: Type.Array(
        Type.Object({
            lines: Type.Array(fileDiffLineSchema),
            newStart: Type.Number(),
            oldStart: Type.Number(),
        }),
    ),
    kind: Type.Union([Type.Literal("add"), Type.Literal("delete"), Type.Literal("update")]),
    language: Type.Optional(Type.String()),
    omittedLines: Type.Optional(Type.Number()),
    path: Type.String(),
});

const applyPatchOutputSchema = Type.Object({
    files: Type.Array(fileDiffSchema),
    omittedFiles: Type.Optional(Type.Number()),
    text: Type.String(),
});

export const codexApplyPatchTool = defineTool({
    name: "apply_patch",
    label: "apply_patch",
    description:
        "Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.",
    executorTool: {
        kind: "custom",
        name: "apply_patch",
        description:
            "The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.",
        format: {
            type: "grammar",
            syntax: "lark",
            definition:
                'start: begin_patch hunk+ end_patch\nbegin_patch: "*** Begin Patch" LF\nend_patch: "*** End Patch" LF?\n\nhunk: add_hunk | delete_hunk | update_hunk\nadd_hunk: "*** Add File: " filename LF add_line+\ndelete_hunk: "*** Delete File: " filename LF\nupdate_hunk: "*** Update File: " filename LF change_move? change?\n\nfilename: /(.+)/\nadd_line: "+" /(.*)/ LF -> line\n\nchange_move: "*** Move to: " filename LF\nchange: (change_context | change_line)+ eof_line?\nchange_context: ("@@" | "@@ " /(.+)/) LF\nchange_line: ("+" | "-" | " ") /(.*)/ LF\neof_line: "*** End of File" LF\n\n%import common.LF\n',
        },
    },
    parseExecutorToolArguments: (argumentsValue) => {
        if (
            typeof argumentsValue === "object" &&
            argumentsValue !== null &&
            "input" in argumentsValue &&
            typeof argumentsValue.input === "string"
        ) {
            return { patch: argumentsValue.input };
        }
        return typeof argumentsValue === "object" && argumentsValue !== null
            ? { ...argumentsValue }
            : {};
    },
    arguments: Type.Object({
        patch: Type.String({
            description: "Patch content using the *** Begin Patch/End Patch format.",
        }),
        workdir: Type.Optional(
            Type.String({ description: "Working directory for relative paths." }),
        ),
    }),
    returnType: applyPatchOutputSchema,
    describeAutoPermissionAction: describeApplyPatchAutoPermissionAction,
    shouldReviewInAutoMode: shouldReviewPatchInAutoMode,
    shouldRunInFullAccessInAutoMode: shouldReviewPatchInAutoMode,
    execute: async ({ patch, workdir }, context) => {
        const cwd = resolveFileSystemPath(
            workdir ?? context.fs.cwd,
            context.fs.cwd,
            context.fs.home,
        );
        const result = await applyPatchText(patch, cwd, context);
        return {
            files: result.files.map((file) => ({
                ...file,
                hunks: file.hunks.map((hunk) => ({
                    ...hunk,
                    lines: hunk.lines.map((line) => ({ ...line })),
                })),
            })),
            ...(result.omittedFiles === undefined ? {} : { omittedFiles: result.omittedFiles }),
            text: result.applied ? result.summary : "patch not applied",
        };
    },
    toLLM: (result) => [{ type: "text", text: result.text }],
    toPresentation: (result) =>
        result.files.length === 0
            ? undefined
            : {
                  files: result.files,
                  ...(result.omittedFiles === undefined
                      ? {}
                      : { omittedFiles: result.omittedFiles }),
                  type: "file_diff",
              },
    toUI: (result) => (result.text === "patch not applied" ? "Patch not applied" : "Applied patch"),
    locks: ["apply_patch"],
});
