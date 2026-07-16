import { dirname } from "node:path";

import { Type } from "@sinclair/typebox";

import type { AgentContext } from "../../agent/context/AgentContext.js";
import { resolveFileSystemPath } from "../../agent/context/resolveFileSystemPath.js";
import { assertReadBeforeModify } from "./assertReadBeforeModify.js";
import { splitLines } from "./path.js";

export const readFileReturnSchema = Type.Object({
    path: Type.String(),
    content: Type.String(),
    startLine: Type.Number(),
    totalLines: Type.Number(),
    returnedLines: Type.Number(),
    truncated: Type.Boolean(),
});

export const writeFileReturnSchema = Type.Object({
    path: Type.String(),
    created: Type.Boolean(),
    bytes: Type.Number(),
});

export const editFileReturnSchema = Type.Object({
    path: Type.String(),
    replacements: Type.Number(),
    fuzzy: Type.Boolean(),
    oldString: Type.String(),
    newString: Type.String(),
});

export interface ReadFileOptions {
    path: string;
    offset?: number;
    limit?: number;
    cwd?: string;
    numbered?: boolean;
}

export interface ReadFileResult {
    path: string;
    content: string;
    startLine: number;
    totalLines: number;
    returnedLines: number;
    truncated: boolean;
}

export async function readTextFile(
    options: ReadFileOptions,
    context: AgentContext,
): Promise<ReadFileResult> {
    const filePath = resolveFileSystemPath(
        options.path,
        options.cwd ?? context.fs.cwd,
        context.fs.home,
    );
    const stats = await context.fs.stat(filePath);
    if (stats.isDirectory) {
        throw new Error(`Path is a directory: ${options.path}`);
    }

    const raw = await context.fs.readFile(filePath);
    context.fileReads?.recordRead(filePath, stats.mtimeMs);
    const lines = splitLines(raw);
    const startLine = Math.max(1, options.offset ?? 1);
    const startIndex = Math.min(lines.length, startLine - 1);
    const limit = options.limit === undefined ? undefined : Math.max(0, options.limit);
    const selected =
        limit === undefined ? lines.slice(startIndex) : lines.slice(startIndex, startIndex + limit);
    const content = options.numbered
        ? selected.map((line, index) => `${startLine + index}\t${line}`).join("\n")
        : selected.join("\n");

    return {
        path: filePath,
        content,
        startLine,
        totalLines: lines.length,
        returnedLines: selected.length,
        truncated: limit !== undefined && startIndex + selected.length < lines.length,
    };
}

export interface WriteFileOptions {
    path: string;
    content: string;
    cwd?: string;
}

export interface WriteFileResult {
    path: string;
    created: boolean;
    bytes: number;
}

export async function writeTextFile(
    options: WriteFileOptions,
    context: AgentContext,
): Promise<WriteFileResult> {
    const filePath = resolveFileSystemPath(
        options.path,
        options.cwd ?? context.fs.cwd,
        context.fs.home,
    );
    await assertReadBeforeModify(filePath, context);
    const created = !(await context.fs.exists(filePath));
    await context.fs.mkdir(dirname(filePath), { recursive: true });
    await context.fs.writeFile(filePath, options.content);
    await recordWriteAsRead(filePath, context);

    return {
        path: filePath,
        created,
        bytes: Buffer.byteLength(options.content, "utf8"),
    };
}

export interface EditFileOptions {
    path: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
    cwd?: string;
    fuzzy?: boolean;
}

export interface EditFileResult {
    path: string;
    replacements: number;
    fuzzy: boolean;
    oldString: string;
    newString: string;
}

export async function editTextFile(
    options: EditFileOptions,
    context: AgentContext,
): Promise<EditFileResult> {
    const plan = await planTextEdit(options, context);
    await assertReadBeforeModify(plan.path, context);
    await context.fs.writeFile(plan.path, plan.nextContent);
    await recordWriteAsRead(plan.path, context);

    return {
        path: plan.path,
        replacements: plan.replacements,
        fuzzy: plan.fuzzy,
        oldString: options.oldString,
        newString: options.newString,
    };
}

interface TextEditPlan {
    path: string;
    nextContent: string;
    replacements: number;
    fuzzy: boolean;
}

export async function planTextEdit(
    options: EditFileOptions,
    context: AgentContext,
): Promise<TextEditPlan> {
    const filePath = resolveFileSystemPath(
        options.path,
        options.cwd ?? context.fs.cwd,
        context.fs.home,
    );
    const content = await context.fs.readFile(filePath);
    return planTextEditInContent(content, filePath, options);
}

function planTextEditInContent(
    content: string,
    filePath: string,
    options: EditFileOptions,
): TextEditPlan {
    if (options.oldString === options.newString) {
        throw new Error("No changes to make: old_string and new_string are identical");
    }

    if (options.oldString.length === 0) {
        throw new Error("old_string must not be empty");
    }

    const allExactPositions = findAllOccurrences(content, options.oldString);
    if (options.replaceAll && allExactPositions.length > 0) {
        return {
            path: filePath,
            nextContent: content.split(options.oldString).join(options.newString),
            replacements: allExactPositions.length,
            fuzzy: false,
        };
    }

    const match = findEditMatch(content, options);
    if (!match) {
        throw new Error(`old_string was not found in ${options.path}`);
    }

    const actualOldString = content.slice(match.start, match.end);
    const nextString = preserveQuoteStyle(options.oldString, actualOldString, options.newString);

    return {
        path: filePath,
        nextContent: content.slice(0, match.start) + nextString + content.slice(match.end),
        replacements: match.replacements,
        fuzzy: match.fuzzy,
    };
}

interface EditMatch {
    start: number;
    end: number;
    replacements: number;
    fuzzy: boolean;
}

function findEditMatch(content: string, options: EditFileOptions): EditMatch | undefined {
    const exact = findExactEditMatch(content, options);
    if (exact) {
        return exact;
    }

    if (options.fuzzy) {
        return findFuzzyEditMatch(content, options);
    }

    return undefined;
}

function findExactEditMatch(content: string, options: EditFileOptions): EditMatch | undefined {
    const positions = findAllOccurrences(content, options.oldString);
    if (positions.length === 0) {
        return undefined;
    }

    if (options.replaceAll) {
        return {
            start: positions[0] ?? 0,
            end: (positions[0] ?? 0) + options.oldString.length,
            replacements: positions.length,
            fuzzy: false,
        };
    }

    if (positions.length > 1) {
        throw new Error(
            `The text to replace appears ${positions.length} times; include more surrounding context to make it unique.`,
        );
    }
    const selected = positions[0];
    if (selected === undefined) return undefined;

    return {
        start: selected,
        end: selected + options.oldString.length,
        replacements: 1,
        fuzzy: false,
    };
}

function findFuzzyEditMatch(content: string, options: EditFileOptions): EditMatch | undefined {
    const candidates = buildFuzzyCandidates(content, options.oldString);
    if (candidates.length === 0) {
        return undefined;
    }

    if (candidates.length > 1) {
        throw new Error(
            `The text to replace has ${candidates.length} fuzzy matches; include more surrounding context to make it unique.`,
        );
    }
    const candidate = candidates[0];
    if (!candidate) return undefined;

    return {
        start: candidate.start,
        end: candidate.end,
        replacements: 1,
        fuzzy: true,
    };
}

function buildFuzzyCandidates(content: string, oldString: string): EditMatch[] {
    const normalizedNeedle = normalizeForEditMatch(oldString);
    if (normalizedNeedle.length === 0) {
        return [];
    }

    const candidates: EditMatch[] = [];
    for (const candidate of candidateWindows(content, oldString)) {
        if (normalizeForEditMatch(candidate.text) === normalizedNeedle) {
            candidates.push({
                start: candidate.start,
                end: candidate.end,
                replacements: 1,
                fuzzy: true,
            });
        }
    }

    return candidates;
}

function* candidateWindows(
    content: string,
    oldString: string,
): Iterable<{ start: number; end: number; text: string }> {
    const lineCount = splitLines(oldString).length;
    const ranges = lineRanges(content);
    for (let i = 0; i < ranges.length; i++) {
        for (let size = Math.max(1, lineCount - 1); size <= lineCount + 1; size++) {
            const endLine = i + size - 1;
            const endRange = ranges[endLine];
            const startRange = ranges[i];
            if (!startRange || !endRange) {
                continue;
            }

            yield {
                start: startRange.start,
                end: endRange.end,
                text: content.slice(startRange.start, endRange.end),
            };
        }
    }
}

function findAllOccurrences(haystack: string, needle: string): number[] {
    if (needle.length === 0) return [];
    const positions: number[] = [];
    let index = haystack.indexOf(needle);
    while (index !== -1) {
        positions.push(index);
        index = haystack.indexOf(needle, index + Math.max(1, needle.length));
    }
    return positions;
}

function normalizeForEditMatch(value: string): string {
    return normalizeQuotes(value)
        .normalize("NFKC")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
        .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();
}

function normalizeQuotes(value: string): string {
    return value
        .replaceAll("\u2018", "'")
        .replaceAll("\u2019", "'")
        .replaceAll("\u201A", "'")
        .replaceAll("\u201B", "'")
        .replaceAll("\u201C", '"')
        .replaceAll("\u201D", '"')
        .replaceAll("\u201E", '"')
        .replaceAll("\u201F", '"');
}

function preserveQuoteStyle(oldString: string, actualOldString: string, newString: string): string {
    if (oldString === actualOldString) {
        return newString;
    }

    let result = newString;
    if (actualOldString.includes("\u201C") || actualOldString.includes("\u201D")) {
        result = replaceStraightQuotes(result, '"', ["\u201C", "\u201D"]);
    }

    if (actualOldString.includes("\u2018") || actualOldString.includes("\u2019")) {
        result = replaceStraightQuotes(result, "'", ["\u2018", "\u2019"]);
    }

    return result;
}

function replaceStraightQuotes(
    value: string,
    quote: string,
    pair: readonly [string, string],
): string {
    let opening = true;
    let out = "";
    for (const char of value) {
        if (char === quote) {
            out += opening ? pair[0] : pair[1];
            opening = !opening;
        } else {
            out += char;
        }
    }
    return out;
}

export interface BatchEdit {
    oldText: string;
    newText: string;
}

export interface BatchEditFileOptions {
    path: string;
    edits: readonly BatchEdit[];
    cwd?: string;
    fuzzy?: boolean;
}

export interface BatchEditFileResult {
    path: string;
    replacements: number;
    fuzzy: boolean;
}

export async function editTextFileBatch(
    options: BatchEditFileOptions,
    context: AgentContext,
): Promise<BatchEditFileResult> {
    if (options.edits.length === 0) {
        throw new Error("At least one edit is required.");
    }
    const emptyEditIndex = options.edits.findIndex((edit) => edit.oldText.length === 0);
    if (emptyEditIndex !== -1) {
        throw new Error(`oldText for edit ${emptyEditIndex + 1} must not be empty.`);
    }

    const filePath = resolveFileSystemPath(
        options.path,
        options.cwd ?? context.fs.cwd,
        context.fs.home,
    );
    await assertReadBeforeModify(filePath, context);
    const rawContent = await context.fs.readFile(filePath);
    const matches = options.edits.map((edit, editIndex) => {
        const editOptions: EditFileOptions = {
            path: options.path,
            oldString: edit.oldText,
            newString: edit.newText,
        };
        if (options.fuzzy !== undefined) editOptions.fuzzy = options.fuzzy;
        const match = findEditMatch(rawContent, editOptions);
        if (!match) {
            throw new Error(
                options.edits.length === 1
                    ? `Could not find the exact text in ${options.path}. The old text must match exactly including all whitespace and newlines.`
                    : `Could not find the exact text for edit ${editIndex + 1} in ${options.path}.`,
            );
        }
        return { ...match, edit };
    });

    const sorted = [...matches].sort((left, right) => left.start - right.start);
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const current = sorted[i];
        if (prev && current && current.start < prev.end) {
            throw new Error("Edit ranges overlap. Merge nearby changes into one edit.");
        }
    }

    let nextContent = rawContent;
    let usedFuzzy = false;
    for (let i = sorted.length - 1; i >= 0; i--) {
        const match = sorted[i];
        if (!match) continue;
        usedFuzzy ||= match.fuzzy;
        const actualOldString = rawContent.slice(match.start, match.end);
        const nextString = preserveQuoteStyle(
            match.edit.oldText,
            actualOldString,
            match.edit.newText,
        );
        nextContent = nextContent.slice(0, match.start) + nextString + nextContent.slice(match.end);
    }

    await context.fs.writeFile(filePath, nextContent);
    await recordWriteAsRead(filePath, context);
    return {
        path: filePath,
        replacements: sorted.length,
        fuzzy: usedFuzzy,
    };
}

// After a successful write the agent knows the file's contents, so refresh the
// recorded read state to the new on-disk mtime; otherwise the next edit in the
// same turn would be rejected as stale.
async function recordWriteAsRead(filePath: string, context: AgentContext): Promise<void> {
    if (!context.fileReads) {
        return;
    }
    const stats = await context.fs.stat(filePath);
    context.fileReads.recordRead(filePath, stats.mtimeMs);
}

function lineRanges(content: string): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = [];
    let start = 0;
    for (let i = 0; i <= content.length; i++) {
        if (i === content.length || content[i] === "\n") {
            ranges.push({ start, end: i });
            start = i + 1;
        }
    }
    return ranges;
}
