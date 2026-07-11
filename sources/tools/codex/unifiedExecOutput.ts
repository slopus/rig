import { Type, type Static } from "@sinclair/typebox";

import type { BashSessionSnapshot } from "../../agent/index.js";

export const unifiedExecOutputSchema = Type.Object({
    chunk_id: Type.Optional(Type.String()),
    exit_code: Type.Optional(Type.Number()),
    original_token_count: Type.Optional(Type.Number()),
    output: Type.String(),
    session_id: Type.Optional(Type.Number()),
    wall_time_seconds: Type.Number(),
});

export type UnifiedExecOutput = Static<typeof unifiedExecOutputSchema>;

export function formatUnifiedExecOutput(result: UnifiedExecOutput): string {
    const sections: string[] = [];
    if (result.chunk_id !== undefined) sections.push(`Chunk ID: ${result.chunk_id}`);
    sections.push(`Wall time: ${result.wall_time_seconds.toFixed(4)} seconds`);
    if (result.exit_code !== undefined) {
        sections.push(`Process exited with code ${result.exit_code}`);
    }
    if (result.session_id !== undefined) {
        sections.push(`Process running with session ID ${result.session_id}`);
    }
    if (result.original_token_count !== undefined) {
        sections.push(`Original token count: ${result.original_token_count}`);
    }
    sections.push("Output:", result.output);
    return sections.join("\n");
}

export function createUnifiedExecOutput(
    snapshot: BashSessionSnapshot,
    wallTimeSeconds: number,
    maxOutputTokens = 10_000,
): UnifiedExecOutput {
    const rawOutput = [snapshot.stdoutDelta, snapshot.stderrDelta]
        .filter((value) => value.length > 0)
        .join("\n");
    const maxCharacters = Math.max(4_000, maxOutputTokens * 4);
    const output =
        rawOutput.length <= maxCharacters
            ? rawOutput
            : `${rawOutput.slice(0, maxCharacters)}\n[output truncated]`;
    return {
        ...(snapshot.status === "running" ? { session_id: snapshot.sessionId } : {}),
        ...(snapshot.status !== "running" && snapshot.exitCode !== null
            ? { exit_code: snapshot.exitCode }
            : {}),
        original_token_count: Math.ceil(rawOutput.length / 4),
        output,
        wall_time_seconds: wallTimeSeconds,
    };
}
