import { dirname } from "node:path";

import type { FileDiff } from "../../agent/ToolResultPresentation.js";
import type { AgentContext } from "../../agent/context/AgentContext.js";
import { BoundedFileDiffCollector } from "./BoundedFileDiffCollector.js";
import { decodeUtf8File } from "./decodeUtf8File.js";
import { iterateDiffContentLines } from "./iterateDiffContentLines.js";
import { resolveFileSystemPath } from "./resolveFileSystemPath.js";
import { seekPatchSequence } from "./seekPatchSequence.js";

export interface ApplyPatchResult {
    applied: boolean;
    files: readonly FileDiff[];
    omittedFiles?: number;
    summary: string;
}

interface SimulatedFile {
    content: string;
    exists: boolean;
    initialContent: string;
    initialExists: boolean;
    initialMode?: number;
    initialMtimeMs?: number;
    mode?: number;
    path: string;
}

interface UpdateSimulation {
    content: string;
    hunks: FileDiff["hunks"];
    index: number;
}

interface NativeMove {
    source: SimulatedFile;
    target: SimulatedFile;
}

interface NativeMoveCandidate extends NativeMove {
    unchanged: boolean;
}

interface PatchReplacement {
    newLines: readonly string[];
    oldLength: number;
    start: number;
}

export async function applyPatchText(
    patch: string,
    cwd: string,
    context: AgentContext,
): Promise<ApplyPatchResult> {
    const lines = patch.replace(/\r\n/g, "\n").split("\n");
    if (lines[0] !== "*** Begin Patch") {
        throw new Error("Invalid patch: missing Begin Patch header");
    }
    if (!lines.some((line) => line === "*** End Patch")) {
        throw new Error("Invalid patch: missing End Patch footer");
    }

    const fileDiffs = new BoundedFileDiffCollector();
    const moveCandidates: NativeMoveCandidate[] = [];
    const pathTouchCounts = new Map<string, number>();
    const simulatedFiles = new Map<string, SimulatedFile>();
    const summaries: string[] = [];
    let index = 1;
    while (index < lines.length) {
        const line = lines[index];
        if (line === "*** End Patch") {
            break;
        }

        if (line?.startsWith("*** Add File: ")) {
            const filename = line.slice("*** Add File: ".length);
            const body: string[] = [];
            index++;
            while (index < lines.length && !lines[index]?.startsWith("*** ")) {
                const addLine = lines[index];
                if (!addLine?.startsWith("+")) {
                    throw new Error(`Invalid add-file line in ${filename}`);
                }
                body.push(addLine.slice(1));
                index++;
            }

            const target = resolveFileSystemPath(filename, cwd, context.fs.home);
            incrementPathTouch(pathTouchCounts, target);
            const simulated = await getOrLoadSimulatedFile(target, simulatedFiles, context);
            if (simulated.exists) {
                throw new Error(`Invalid patch: add file already exists: ${filename}`);
            }
            simulated.content = body.join("\n");
            simulated.exists = true;
            fileDiffs.addWholeFile(filename, "add", body);
            summaries.push(`A ${filename}`);
            continue;
        }

        if (line?.startsWith("*** Delete File: ")) {
            const filename = line.slice("*** Delete File: ".length);
            const source = resolveFileSystemPath(filename, cwd, context.fs.home);
            incrementPathTouch(pathTouchCounts, source);
            const simulated = await getExistingSimulatedFile(source, simulatedFiles, context);
            const deletedContent = simulated.content;
            simulated.content = "";
            simulated.exists = false;
            fileDiffs.addWholeFile(filename, "delete", iterateDiffContentLines(deletedContent));
            summaries.push(`D ${filename}`);
            index++;
            continue;
        }

        if (line?.startsWith("*** Update File: ")) {
            const filename = line.slice("*** Update File: ".length);
            const source = resolveFileSystemPath(filename, cwd, context.fs.home);
            incrementPathTouch(pathTouchCounts, source);
            const simulated = await getExistingSimulatedFile(source, simulatedFiles, context);
            const sourceContent = simulated.content;
            index++;

            let moveTo: string | undefined;
            if (lines[index]?.startsWith("*** Move to: ")) {
                moveTo = lines[index]?.slice("*** Move to: ".length) ?? "";
                index++;
            }

            const destination = moveTo ?? filename;
            const moveTarget = resolveFileSystemPath(destination, cwd, context.fs.home);
            const isMove = moveTo !== undefined && moveTarget !== source;
            const update = simulateUpdateFilePatch(lines, index, filename, sourceContent, isMove);
            index = update.index;

            if (!isMove) {
                simulated.content = update.content;
                fileDiffs.add({
                    hunks: update.hunks,
                    kind: "update",
                    path: filename,
                });
            } else {
                const target = moveTarget;
                incrementPathTouch(pathTouchCounts, target);
                const targetSimulation = await getOrLoadSimulatedFile(
                    target,
                    simulatedFiles,
                    context,
                );
                if (targetSimulation.exists) {
                    throw new Error(`Invalid patch: move target already exists: ${moveTo}`);
                }
                simulated.content = "";
                simulated.exists = false;
                targetSimulation.content = update.content;
                targetSimulation.exists = true;
                if (simulated.mode === undefined) {
                    delete targetSimulation.mode;
                } else {
                    targetSimulation.mode = simulated.mode;
                }
                moveCandidates.push({
                    source: simulated,
                    target: targetSimulation,
                    unchanged: update.content === sourceContent,
                });
                fileDiffs.addWholeFile(filename, "delete", iterateDiffContentLines(sourceContent));
                fileDiffs.addWholeFile(destination, "add", iterateDiffContentLines(update.content));
            }

            summaries.push(`M ${filename}`);
            continue;
        }

        throw new Error(`Invalid patch directive: ${line ?? ""}`);
    }

    if (summaries.length === 0) {
        throw new Error("Invalid patch: no file changes were provided");
    }

    const nativeMoves = moveCandidates.filter(
        ({ source, target, unchanged }) =>
            unchanged &&
            pathTouchCounts.get(source.path) === 1 &&
            pathTouchCounts.get(target.path) === 1,
    );
    await commitSimulatedFiles(simulatedFiles, nativeMoves, context);

    const presentation = fileDiffs.finish();
    return {
        applied: true,
        files: presentation.files,
        ...(presentation.omittedFiles === undefined
            ? {}
            : { omittedFiles: presentation.omittedFiles }),
        summary: ["Success. Updated the following files:", ...summaries].join("\n"),
    };
}

async function commitSimulatedFiles(
    simulatedFiles: ReadonlyMap<string, SimulatedFile>,
    nativeMoves: readonly NativeMove[],
    context: AgentContext,
): Promise<void> {
    const nativeMovePaths = new Set(
        nativeMoves.flatMap(({ source, target }) => [source.path, target.path]),
    );
    const changed = [...simulatedFiles.values()].filter(
        (file) =>
            !nativeMovePaths.has(file.path) &&
            (file.exists !== file.initialExists ||
                (file.exists && file.content !== file.initialContent)),
    );
    if (changed.length === 0 && nativeMoves.length === 0) {
        throw new Error("Invalid patch: patch makes no changes");
    }
    const attempted: SimulatedFile[] = [];
    const completedMoves: NativeMove[] = [];
    const createdDirectories = new Set<string>();
    try {
        for (const nativeMove of nativeMoves) {
            await trackMissingParentDirectories(
                nativeMove.target.path,
                createdDirectories,
                context,
            );
            await context.fs.mkdir(dirname(nativeMove.target.path), { recursive: true });
            await context.fs.move(nativeMove.source.path, nativeMove.target.path);
            completedMoves.push(nativeMove);
        }
        for (const simulated of changed) {
            if (simulated.exists) {
                await trackMissingParentDirectories(simulated.path, createdDirectories, context);
                await context.fs.mkdir(dirname(simulated.path), { recursive: true });
                attempted.push(simulated);
                await context.fs.writeFile(simulated.path, simulated.content);
                if (simulated.mode !== undefined) {
                    await context.fs.chmod(simulated.path, simulated.mode);
                }
            }
        }
        for (const simulated of changed) {
            if (!simulated.exists && simulated.initialExists) {
                await context.fs.rm(simulated.path);
                attempted.push(simulated);
            }
        }
    } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const simulated of [...attempted].reverse()) {
            try {
                if (simulated.initialExists) {
                    await context.fs.mkdir(dirname(simulated.path), { recursive: true });
                    await context.fs.writeFile(simulated.path, simulated.initialContent);
                    if (simulated.initialMode !== undefined) {
                        await context.fs.chmod(simulated.path, simulated.initialMode);
                    }
                    if (simulated.initialMtimeMs !== undefined) {
                        await context.fs.setModificationTime(
                            simulated.path,
                            simulated.initialMtimeMs,
                        );
                    }
                } else {
                    await context.fs.rm(simulated.path, { force: true });
                }
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        for (const nativeMove of [...completedMoves].reverse()) {
            try {
                await context.fs.mkdir(dirname(nativeMove.source.path), { recursive: true });
                await context.fs.move(nativeMove.target.path, nativeMove.source.path);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        for (const directory of [...createdDirectories].sort(
            (left, right) => right.length - left.length,
        )) {
            try {
                if (!(await context.fs.exists(directory))) continue;
                if ((await context.fs.readdir(directory)).length > 0) {
                    throw new Error(`Rollback directory is not empty: ${directory}`);
                }
                await context.fs.rm(directory, { recursive: true });
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        if (rollbackErrors.length > 0) {
            throw new AggregateError(
                [error, ...rollbackErrors],
                "Patch commit failed and the filesystem rollback was incomplete.",
            );
        }
        throw error;
    }
}

async function trackMissingParentDirectories(
    path: string,
    directories: Set<string>,
    context: AgentContext,
): Promise<void> {
    let current = dirname(path);
    while (dirname(current) !== current && !(await context.fs.exists(current))) {
        directories.add(current);
        current = dirname(current);
    }
}

async function getExistingSimulatedFile(
    path: string,
    simulatedFiles: Map<string, SimulatedFile>,
    context: AgentContext,
): Promise<SimulatedFile> {
    const existing = simulatedFiles.get(path);
    if (existing !== undefined) {
        if (!existing.exists) throw new Error(`File does not exist: ${path}`);
        return existing;
    }

    const metadata = await context.fs.lstat(path);
    if (!metadata.isFile) {
        const kind = metadata.isSymbolicLink ? "symbolic link" : "non-regular file";
        throw new Error(`Invalid patch: cannot modify ${kind}: ${path}`);
    }
    const content = decodeUtf8File(await context.fs.readFileBuffer(path), path);
    const simulated: SimulatedFile = {
        content,
        exists: true,
        initialContent: content,
        initialExists: true,
        ...(metadata.mode === undefined ? {} : { initialMode: metadata.mode, mode: metadata.mode }),
        initialMtimeMs: metadata.mtimeMs,
        path,
    };
    simulatedFiles.set(path, simulated);
    return simulated;
}

async function getOrLoadSimulatedFile(
    path: string,
    simulatedFiles: Map<string, SimulatedFile>,
    context: AgentContext,
): Promise<SimulatedFile> {
    const existing = simulatedFiles.get(path);
    if (existing !== undefined) return existing;

    const initialExists = await context.fs.exists(path);
    const metadata = initialExists ? await context.fs.lstat(path) : undefined;
    const content =
        metadata?.isFile === true
            ? decodeUtf8File(await context.fs.readFileBuffer(path), path)
            : "";
    const simulated: SimulatedFile = {
        content,
        exists: initialExists,
        initialContent: content,
        initialExists,
        ...(metadata?.mode === undefined
            ? {}
            : { initialMode: metadata.mode, mode: metadata.mode }),
        ...(metadata === undefined ? {} : { initialMtimeMs: metadata.mtimeMs }),
        path,
    };
    simulatedFiles.set(path, simulated);
    return simulated;
}

function simulateUpdateFilePatch(
    lines: readonly string[],
    initialIndex: number,
    filename: string,
    initialContent: string,
    allowUnchangedContent = false,
): UpdateSimulation {
    const hunks: FileDiff["hunks"][number][] = [];
    const document = splitContentDocument(initialContent);
    const originalLines = document.lines;
    const replacements: PatchReplacement[] = [];
    let index = initialIndex;
    let searchCursor = 0;

    while (index < lines.length && !lines[index]?.startsWith("*** ")) {
        const header = lines[index];
        if (header !== "@@" && !header?.startsWith("@@ ")) {
            throw new Error(`Invalid update hunk for ${filename}`);
        }
        if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@$/.test(header)) {
            throw new Error(
                `Invalid patch: unified diff hunk headers are not supported for ${filename}`,
            );
        }
        const anchor = header === "@@" ? undefined : header.slice(3);

        index++;
        const add: string[] = [];
        const diffLines: FileDiff["hunks"][number]["lines"][number][] = [];
        const remove: string[] = [];
        while (
            index < lines.length &&
            !lines[index]?.startsWith("@@") &&
            !lines[index]?.startsWith("*** ")
        ) {
            const patchLine = lines[index] ?? "";
            const marker = patchLine[0];
            const text = patchLine.slice(1);
            if (marker === " ") {
                remove.push(text);
                add.push(text);
                diffLines.push({ kind: "context", text });
            } else if (marker === "-") {
                remove.push(text);
                diffLines.push({ kind: "delete", text });
            } else if (marker === "+") {
                add.push(text);
                diffLines.push({ kind: "add", text });
            } else {
                throw new Error(`Invalid update line for ${filename}`);
            }
            index++;
        }

        if (anchor !== undefined) {
            const anchorIndex = seekPatchSequence(originalLines, [anchor], searchCursor);
            if (anchorIndex < 0) {
                throw new Error(`Invalid patch: hunk did not match ${filename}`);
            }
            searchCursor = anchorIndex + 1;
        }
        const isEndOfFile = lines[index] === "*** End of File";
        if (isEndOfFile) index++;
        const matchIndex =
            remove.length === 0
                ? originalLines.length
                : seekPatchSequence(originalLines, remove, searchCursor, isEndOfFile);
        if (matchIndex < 0) {
            throw new Error(`Invalid patch: hunk did not match ${filename}`);
        }

        const priorLineDelta = replacements.reduce(
            (total, replacement) =>
                replacement.start <= matchIndex
                    ? total + replacement.newLines.length - replacement.oldLength
                    : total,
            0,
        );
        const newStart = Math.max(1, matchIndex + priorLineDelta + 1);
        hunks.push({
            lines: diffLines,
            newStart,
            oldStart: Math.max(1, matchIndex + 1),
        });
        replacements.push({ newLines: add, oldLength: remove.length, start: matchIndex });
        if (remove.length > 0) searchCursor = matchIndex + remove.length;
    }

    const contentLines = [...originalLines];
    for (const replacement of [...replacements].reverse()) {
        contentLines.splice(replacement.start, replacement.oldLength, ...replacement.newLines);
    }
    const content = joinContentDocument(contentLines, document.eol, document.hasFinalNewline);

    if (
        !allowUnchangedContent &&
        (hunks.length === 0 ||
            content === initialContent ||
            !hunks.some((hunk) => hunk.lines.some((line) => line.kind !== "context")))
    ) {
        throw new Error(`Invalid patch: update contains no changes for ${filename}`);
    }

    return { content, hunks, index };
}

function joinContentDocument(
    lines: readonly string[],
    eol: string,
    hasFinalNewline: boolean,
): string {
    if (lines.length === 0) return "";
    return lines.join(eol) + (hasFinalNewline ? eol : "");
}

function splitContentDocument(content: string): {
    eol: string;
    hasFinalNewline: boolean;
    lines: readonly string[];
} {
    if (content.length === 0) return { eol: "\n", hasFinalNewline: false, lines: [] };
    const eol = content.includes("\r\n") ? "\r\n" : content.includes("\r") ? "\r" : "\n";
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const hasFinalNewline = normalized.endsWith("\n");
    const lines = normalized.split("\n");
    if (hasFinalNewline) lines.pop();
    return { eol, hasFinalNewline, lines };
}

function incrementPathTouch(counts: Map<string, number>, path: string): void {
    counts.set(path, (counts.get(path) ?? 0) + 1);
}
