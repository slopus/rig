import type { AnyDefinedTool } from "../agent/types.js";
import { renderJsonSchemaToTypeScript } from "./renderJsonSchemaToTypeScript.js";

const EXEC_DESCRIPTION = `Run JavaScript code to orchestrate/compose tool calls
- Evaluates the provided JavaScript code in a fresh V8 isolate as an async module.
- All nested tools are available on the global \`tools\` object, for example \`await tools.exec_command(...)\`. Tool names are exposed as normalized JavaScript identifiers, for example \`await tools.mcp__ologs__get_profile(...)\`.
- Nested tool methods take either a string or an object as their input argument.
- Nested tools return either an object or a string, based on the description.
- Runs raw JavaScript -- no Node, no file system, no network access, no console.
- Accepts raw JavaScript source text, not JSON, quoted strings, or markdown code fences.
- You may optionally start the tool input with a first-line pragma like \`// @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}\`.
- \`yield_time_ms\` asks \`exec\` to yield early if the script is still running. Defaults to 10000 ms.
- \`max_output_tokens\` sets the token budget for direct \`exec\` results. Defaults to 10000 tokens.
- When the JS code is fully evaluated, the isolate's lifetime ends and unawaited promises are silently discarded.

- Global helpers:
- \`exit()\`: Immediately ends the current script successfully (like an early return from the top level).
- \`text(value: string | number | boolean | undefined | null)\`: Appends a text item. Non-string values are stringified with \`JSON.stringify(...)\` when possible.
- \`image(imageUrlOrItem: string | { image_url: string; detail?: "auto" | "low" | "high" | "original" | null } | ImageContent, detail?: "auto" | "low" | "high" | "original" | null)\`: Appends an image item. \`image_url\` should be a base64-encoded \`data:\` URL. To forward an MCP tool image, pass an individual \`ImageContent\` block from \`result.content\`, for example \`image(result.content[0])\`. MCP image blocks may request detail with \`_meta: { "codex/imageDetail": "original" }\`. When provided, the second \`detail\` argument overrides any detail embedded in the first argument.
- \`generatedImage(result: { image_url: string; output_hint?: string })\`: Appends an image-generation result and its optional output hint. HTTP(S) URLs are not supported.
- \`store(key: string, value: any)\`: stores a serializable value under a string key for later \`exec\` calls in the same session.
- \`load(key: string)\`: returns the stored value for a string key, or \`undefined\` if it is missing.
- \`setTimeout(callback: () => void, delayMs?: number)\`: schedules a callback to run later and returns a timeout id. Pending timeouts do not keep \`exec\` alive by themselves; await an explicit promise if you need to wait for one.
- \`clearTimeout(timeoutId?: number)\`: cancels a timeout created by \`setTimeout\`.
- \`ALL_TOOLS\`: metadata for the enabled nested tools as \`{ name, description }\` entries.
- \`yield_control()\`: yields the accumulated output to the model immediately while the script keeps running.`;

export function createCodeModeExecDescription(tools: readonly AnyDefinedTool[]): string {
    const sections = [EXEC_DESCRIPTION];
    let currentNamespace: string | undefined;
    for (const tool of tools) {
        const namespace = tool.codeMode?.namespace;
        if (namespace !== currentNamespace && namespace !== undefined) {
            sections.push(
                `## ${namespace}\nTools for spawning, messaging, waiting on, and managing sub-agents.`,
            );
        }
        currentNamespace = namespace;
        const globalName = codeModeGlobalName(tool);
        const kind = tool.codeMode?.kind ?? "function";
        const inputName = kind === "freeform" ? "input" : "args";
        const inputType =
            kind === "freeform" ? "string" : renderJsonSchemaToTypeScript(tool.arguments);
        const outputType = renderJsonSchemaToTypeScript(tool.returnType);
        sections.push(
            `### \`${globalName}\`${globalName === tool.name ? "" : ` (\`${tool.name}\`)`}\n${tool.description.trim()}\n\nexec tool declaration:\n\`\`\`ts\ndeclare const tools: { ${globalName}(${inputName}: ${inputType}): Promise<${outputType}>; };\n\`\`\``,
        );
    }
    return sections.join("\n\n");
}

export function codeModeGlobalName(tool: AnyDefinedTool): string {
    return normalizeCodeModeIdentifier(
        tool.codeMode?.namespace === undefined
            ? tool.name
            : `${tool.codeMode.namespace}__${tool.name}`,
    );
}

function normalizeCodeModeIdentifier(value: string): string {
    const normalized = [...value]
        .map((character, index) =>
            (index === 0 ? /[A-Za-z_$]/ : /[A-Za-z0-9_$]/).test(character) ? character : "_",
        )
        .join("");
    return normalized === "" ? "_" : normalized;
}
