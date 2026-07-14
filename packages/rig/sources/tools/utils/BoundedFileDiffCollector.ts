import type { FileDiff, FileDiffKind, FileDiffLine } from "../../agent/ToolResultPresentation.js";

export const MAX_FILE_DIFF_PRESENTATION_FILES = 20;
export const MAX_FILE_DIFF_PRESENTATION_LINES = 500;
export const MAX_FILE_DIFF_PRESENTATION_LINE_CHARACTERS = 2_000;

export interface BoundedFileDiffCollection {
    readonly files: readonly FileDiff[];
    readonly omittedFiles?: number;
}

export class BoundedFileDiffCollector {
    readonly #files: FileDiff[] = [];
    #omittedFiles = 0;
    #retainedLines = 0;

    add(diff: FileDiff): void {
        if (!this.#canRetainFile()) return;

        let added = 0;
        let deleted = 0;
        let omittedLines = 0;
        const hunks: FileDiff["hunks"][number][] = [];
        for (const hunk of diff.hunks) {
            const lines: FileDiffLine[] = [];
            for (const line of hunk.lines) {
                if (line.kind === "add") added += 1;
                if (line.kind === "delete") deleted += 1;
                if (this.#retainedLines < MAX_FILE_DIFF_PRESENTATION_LINES) {
                    lines.push({
                        kind: line.kind,
                        text: truncatePresentationText(line.text),
                    });
                    this.#retainedLines += 1;
                } else {
                    omittedLines += 1;
                }
            }
            if (lines.length > 0) {
                hunks.push({ lines, newStart: hunk.newStart, oldStart: hunk.oldStart });
            }
        }

        this.#files.push({
            hunks,
            kind: diff.kind,
            ...(diff.language === undefined ? {} : { language: diff.language }),
            ...(omittedLines === 0 ? {} : { added, deleted, omittedLines }),
            path: truncatePresentationText(diff.path),
        });
    }

    addWholeFile(
        path: string,
        kind: Extract<FileDiffKind, "add" | "delete">,
        contentLines: Iterable<string>,
    ): void {
        if (!this.#canRetainFile()) return;

        let lineCount = 0;
        let omittedLines = 0;
        const lines: FileDiffLine[] = [];
        for (const text of contentLines) {
            lineCount += 1;
            if (this.#retainedLines < MAX_FILE_DIFF_PRESENTATION_LINES) {
                lines.push({ kind, text: truncatePresentationText(text) });
                this.#retainedLines += 1;
            } else {
                omittedLines += 1;
            }
        }

        this.#files.push({
            hunks: [
                {
                    lines,
                    newStart: kind === "add" ? 1 : 0,
                    oldStart: kind === "delete" ? 1 : 0,
                },
            ],
            kind,
            ...(omittedLines === 0
                ? {}
                : {
                      added: kind === "add" ? lineCount : 0,
                      deleted: kind === "delete" ? lineCount : 0,
                      omittedLines,
                  }),
            path: truncatePresentationText(path),
        });
    }

    finish(): BoundedFileDiffCollection {
        return {
            files: this.#files,
            ...(this.#omittedFiles === 0 ? {} : { omittedFiles: this.#omittedFiles }),
        };
    }

    #canRetainFile(): boolean {
        if (this.#files.length < MAX_FILE_DIFF_PRESENTATION_FILES) return true;
        this.#omittedFiles += 1;
        return false;
    }
}

function truncatePresentationText(text: string): string {
    let characterCount = 0;
    let end = 0;
    for (const character of text) {
        if (characterCount === MAX_FILE_DIFF_PRESENTATION_LINE_CHARACTERS) break;
        characterCount += 1;
        end += character.length;
    }
    return end === text.length ? text : text.slice(0, end);
}
