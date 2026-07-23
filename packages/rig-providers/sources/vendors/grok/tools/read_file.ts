import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const read_file = {
    name: "read_file",
    type: "local",
    description:
        "Read a file.\n\nUsage:\n- The target_file parameter can be a relative path in the workspace or an absolute path\n- By default, it reads up to 1000 lines starting from the beginning of the file\n- Results are returned with line numbers starting at 1. The format is: LINE_NUMBER→LINE_CONTENT\n- This tool can read PDF files (.pdf), PowerPoint files (.pptx), Jupyter notebooks (.ipynb files), and image files (e.g. PNG, JPG, etc).\n- When reading an image file the contents are presented visually as this tool uses multimodal LLMs.",
    parameters: Type.Object(
        {
            target_file: Type.String({
                description:
                    "The path of the file to read. You can use either a relative path in the workspace or an absolute path. If an absolute path is provided, it will be preserved as is.",
            }),
            offset: Type.Optional(
                Type.Integer({
                    description:
                        "The line number to start reading from. Only provide if the file is too large to read at once.",
                    default: 1,
                }),
            ),
            limit: Type.Optional(
                Type.Integer({
                    description:
                        "The number of lines to read. Only provide if the file is too large to read at once.",
                }),
            ),
            pages: Type.Optional(
                Type.Unsafe({
                    description:
                        "Page range for PDF files (e.g. '1-5', '3', '10-'). Required for PDFs with more than 10 pages. Max 20 pages per call. Ignored for non-PDF files.",
                    type: ["string", "null"],
                }),
            ),
            format: Type.Optional(
                Type.Unsafe({
                    description:
                        "Output format for PDF files. 'image' (default) renders pages as images. 'text' extracts text content. Ignored for non-PDF files.",
                    type: ["string", "null"],
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "ReadFileInput",
        },
    ),
} as const satisfies SessionTool;
