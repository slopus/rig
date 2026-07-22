const PRAGMA_PREFIX = "// @exec:";
const MAX_OUTPUT_TOKENS = 2_147_483_647;

export interface ParsedCodeModeExecInput {
    code: string;
    maxOutputTokens?: number;
    yieldTimeMs?: number;
}

export function parseCodeModeExecInput(input: string): ParsedCodeModeExecInput {
    if (input.trim() === "") {
        throw new Error(
            'exec expects raw JavaScript source text (non-empty). Provide JS only, optionally with first-line `// @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}`.',
        );
    }
    const newline = input.indexOf("\n");
    const firstLine = newline === -1 ? input : input.slice(0, newline);
    const trimmed = firstLine.trimStart();
    if (!trimmed.startsWith(PRAGMA_PREFIX)) return { code: input };

    const code = newline === -1 ? "" : input.slice(newline + 1);
    if (code.trim() === "") {
        throw new Error("exec pragma must be followed by JavaScript source on subsequent lines");
    }
    const directive = trimmed.slice(PRAGMA_PREFIX.length).trim();
    let value: unknown;
    try {
        value = JSON.parse(directive);
    } catch (error) {
        throw new Error(
            `exec pragma must be valid JSON with supported fields \`yield_time_ms\` and \`max_output_tokens\`: ${String(error)}`,
        );
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(
            "exec pragma must be a JSON object with supported fields `yield_time_ms` and `max_output_tokens`",
        );
    }
    const pragma = value as Record<string, unknown>;
    for (const key of Object.keys(pragma)) {
        if (key !== "yield_time_ms" && key !== "max_output_tokens") {
            throw new Error(
                `exec pragma only supports \`yield_time_ms\` and \`max_output_tokens\`; got \`${key}\``,
            );
        }
    }
    const yieldTimeMs = parseSafeInteger(pragma["yield_time_ms"], "yield_time_ms");
    const maxOutputTokens = parseSafeInteger(
        pragma["max_output_tokens"],
        "max_output_tokens",
        MAX_OUTPUT_TOKENS,
    );
    return {
        code,
        ...(yieldTimeMs === undefined ? {} : { yieldTimeMs }),
        ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    };
}

function parseSafeInteger(
    value: unknown,
    field: string,
    maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
        throw new Error(
            `exec pragma field \`${field}\` must be a non-negative integer no greater than ${String(maximum)}`,
        );
    }
    return value as number;
}
