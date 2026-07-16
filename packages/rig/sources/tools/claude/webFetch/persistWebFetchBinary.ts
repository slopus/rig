import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getRigHome } from "../../../config/getRigHome.js";

const EXTENSIONS = new Map<string, string>([
    ["application/pdf", "pdf"],
    ["application/zip", "zip"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/gif", "gif"],
    ["image/webp", "webp"],
]);

export async function persistWebFetchBinary(
    bytes: Buffer,
    contentType: string,
): Promise<string | undefined> {
    const mediaType = (contentType.split(";")[0] ?? "").trim().toLowerCase();
    const extension = EXTENSIONS.get(mediaType) ?? "bin";
    const directory = join(getRigHome(), "tool-results");
    const path = join(
        directory,
        `webfetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`,
    );

    try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(path, bytes, { mode: 0o600 });
        return path;
    } catch {
        return undefined;
    }
}
