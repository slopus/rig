import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { resolveFileSystemPath } from "../../context/resolveFileSystemPath.js";
import { describeFileAutoPermissionAction } from "../../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../../permissions/shouldReviewPathInAutoMode.js";
import {
    IMAGE_PROCESSING_ERROR_PLACEHOLDER,
    ImageProcessingError,
    MAX_PROMPT_IMAGE_INPUT_BYTES,
    prepareImageForPrompt,
} from "../../../tools/utils/index.js";

const viewImageReturnSchema = Type.Object({
    image_url: Type.String(),
    detail: Type.Union([Type.Literal("high"), Type.Literal("original")]),
});

export const codexViewImageTool = defineTool({
    name: "view_image",
    label: "view_image",
    description:
        "View a local image file from the filesystem when visual inspection is needed. Use this for images already available on disk.",
    executorTool: {
        name: "view_image",
        description:
            "View a local image file from the filesystem when visual inspection is needed. Use this for images already available on disk.",
        parameters: Type.Object(
            {
                detail: Type.Optional(
                    Type.Union([Type.Literal("high"), Type.Literal("original")], {
                        description:
                            "Image detail level. Defaults to `high`; use `original` to preserve exact resolution.",
                    }),
                ),
                path: Type.String({ description: "Local filesystem path to an image file." }),
            },
            { additionalProperties: false },
        ),
    },
    arguments: Type.Object({
        path: Type.String({ description: "Local filesystem path to an image file." }),
        detail: Type.Optional(
            Type.Union([Type.Literal("high"), Type.Literal("original")], {
                description:
                    "Image detail level. Defaults to `high`; use `original` to preserve exact resolution.",
            }),
        ),
    }),
    returnType: viewImageReturnSchema,
    describeAutoPermissionAction: ({ path }, context) =>
        describeFileAutoPermissionAction(path, context, "viewing"),
    shouldReviewInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path, context, { write: false }),
    shouldRunInFullAccessInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path, context, { write: false }),
    execute: async ({ path, detail }, context) => {
        const resolvedPath = resolveFileSystemPath(path, context.fs.cwd, context.fs.home);
        const stat = await context.fs.stat(resolvedPath);
        if (!stat.isFile) {
            throw new Error(`Image path '${path}' is not a file.`);
        }
        if (stat.size > MAX_PROMPT_IMAGE_INPUT_BYTES) {
            return {
                image_url: IMAGE_PROCESSING_ERROR_PLACEHOLDER,
                detail: detail ?? "high",
            };
        }
        const bytes = await context.fs.readFileBuffer(resolvedPath);
        const resolvedDetail = detail ?? "high";
        try {
            const image = await prepareImageForPrompt(bytes, resolvedDetail);
            return {
                image_url: `data:${image.mediaType};base64,${image.bytes.toString("base64")}`,
                detail: resolvedDetail,
            };
        } catch (error) {
            if (error instanceof ImageProcessingError) {
                return {
                    image_url: IMAGE_PROCESSING_ERROR_PLACEHOLDER,
                    detail: resolvedDetail,
                };
            }
            throw error;
        }
    },
    toLLM: (result) => {
        const match = /^data:([^;]+);base64,(.*)$/.exec(result.image_url);
        return match
            ? [
                  {
                      type: "image",
                      mediaType: match[1] ?? "image/png",
                      data: match[2] ?? "",
                      detail: result.detail,
                  },
              ]
            : [{ type: "text", text: result.image_url }];
    },
    toUI: (_result, args) => `Viewed ${args.path}`,
    locks: [],
});
