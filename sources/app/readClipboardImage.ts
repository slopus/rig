import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ClipboardImage {
    data: string;
    mediaType: string;
    path: string;
}

export interface ReadClipboardImageOptions {
    outputDirectory?: string;
}

type ClipboardModule = {
    getImageBinary: () => Promise<Array<number>>;
    hasImage: () => boolean;
};

interface RawClipboardImage {
    bytes: Buffer;
    mediaType: string;
}

const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const DEFAULT_LIST_TIMEOUT_MS = 1_000;
const DEFAULT_READ_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

export async function readClipboardImage(
    options: ReadClipboardImageOptions = {},
): Promise<ClipboardImage | undefined> {
    const rawImage =
        process.platform === "linux" && isWaylandSession()
            ? (readClipboardImageViaWlPaste() ?? readClipboardImageViaXclip())
            : await readClipboardImageViaNativeClipboard();

    if (rawImage === undefined) {
        return undefined;
    }

    const path = writeClipboardImageFile(rawImage, options.outputDirectory);
    return {
        data: rawImage.bytes.toString("base64"),
        mediaType: rawImage.mediaType,
        path,
    };
}

function readClipboardImageViaWlPaste(): RawClipboardImage | undefined {
    const list = runCommand("wl-paste", ["--list-types"], {
        timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
    });
    if (!list.ok) {
        return undefined;
    }

    const selectedType = selectPreferredImageMimeType(lines(list.stdout));
    if (selectedType === undefined) {
        return undefined;
    }

    const data = runCommand("wl-paste", ["--type", selectedType, "--no-newline"]);
    if (!data.ok || data.stdout.length === 0) {
        return undefined;
    }

    return { bytes: data.stdout, mediaType: baseMimeType(selectedType) };
}

function readClipboardImageViaXclip(): RawClipboardImage | undefined {
    const targets = runCommand("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"], {
        timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
    });
    const preferred = targets.ok ? selectPreferredImageMimeType(lines(targets.stdout)) : undefined;
    const tryTypes =
        preferred === undefined
            ? [...SUPPORTED_IMAGE_MIME_TYPES]
            : [preferred, ...SUPPORTED_IMAGE_MIME_TYPES];

    for (const mimeType of tryTypes) {
        const data = runCommand("xclip", ["-selection", "clipboard", "-t", mimeType, "-o"]);
        if (data.ok && data.stdout.length > 0) {
            return { bytes: data.stdout, mediaType: baseMimeType(mimeType) };
        }
    }

    return undefined;
}

async function readClipboardImageViaNativeClipboard(): Promise<RawClipboardImage | undefined> {
    const clipboard = loadClipboardModule();
    if (clipboard === undefined || !clipboard.hasImage()) {
        return undefined;
    }

    const imageData = await clipboard.getImageBinary();
    if (imageData.length === 0) {
        return undefined;
    }

    return { bytes: Buffer.from(imageData), mediaType: "image/png" };
}

function loadClipboardModule(): ClipboardModule | undefined {
    try {
        const require = createRequire(import.meta.url);
        return require("@mariozechner/clipboard") as ClipboardModule;
    } catch {
        return undefined;
    }
}

function writeClipboardImageFile(
    image: RawClipboardImage,
    outputDirectory: string | undefined,
): string {
    const directory = outputDirectory ?? join(tmpdir(), "rig-clipboard-images");
    mkdirSync(directory, { recursive: true });
    const path = join(
        directory,
        `rig-clipboard-${randomUUID()}.${extensionForMimeType(image.mediaType)}`,
    );
    writeFileSync(path, image.bytes);
    return path;
}

function extensionForMimeType(mimeType: string): string {
    switch (baseMimeType(mimeType)) {
        case "image/jpeg":
            return "jpg";
        case "image/webp":
            return "webp";
        case "image/gif":
            return "gif";
        default:
            return "png";
    }
}

function selectPreferredImageMimeType(mimeTypes: readonly string[]): string | undefined {
    const normalized = mimeTypes
        .map((type) => ({ base: baseMimeType(type), raw: type.trim() }))
        .filter((type) => type.raw.length > 0);

    for (const preferred of SUPPORTED_IMAGE_MIME_TYPES) {
        const match = normalized.find((type) => type.base === preferred);
        if (match !== undefined) {
            return match.raw;
        }
    }

    return normalized.find((type) => type.base.startsWith("image/"))?.raw;
}

function baseMimeType(mimeType: string): string {
    return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function isWaylandSession(): boolean {
    return Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === "wayland";
}

function lines(buffer: Buffer): string[] {
    return buffer
        .toString("utf8")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

function runCommand(
    command: string,
    args: readonly string[],
    options: { maxBufferBytes?: number; timeoutMs?: number } = {},
): { ok: boolean; stdout: Buffer } {
    const result = spawnSync(command, [...args], {
        maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
        timeout: options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    });

    if (result.error !== undefined || result.status !== 0) {
        return { ok: false, stdout: Buffer.alloc(0) };
    }

    return {
        ok: true,
        stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ""),
    };
}
