#!/usr/bin/env node

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const fixture = JSON.parse(
    await readFile(new URL("./fixtures/grok-4-5-compaction.sse.json", import.meta.url), "utf8"),
);
const inferenceFixture = JSON.parse(
    await readFile(new URL("./fixtures/grok-4-5-low.sse.json", import.meta.url), "utf8"),
);
const compaction = fixture.exchanges.find((exchange) => exchange.kind === "compaction");
if (compaction === undefined) throw new Error("The fixture has no compaction exchange.");
const request = compaction.request;
const promptDirectory = new URL("../../sources/vendors/grok/prompts/", import.meta.url);
const toolDirectory = new URL("../../sources/vendors/grok/tools/", import.meta.url);
await mkdir(promptDirectory, { recursive: true });
await mkdir(toolDirectory, { recursive: true });

await writeFile(
    new URL("grok_4_5_system_prompt.ts", promptDirectory),
    formatPrompt(inferenceFixture.request.input[0].content),
);

for (const entry of await readdir(toolDirectory)) {
    if (entry.endsWith(".ts")) await rm(new URL(entry, toolDirectory));
}
for (const tool of request.tools) {
    await writeFile(new URL(`${tool.name}.ts`, toolDirectory), formatTool(tool));
}
await writeFile(new URL("index.ts", toolDirectory), formatToolIndex(request.tools));

function formatPrompt(prompt) {
    const chunks = [];
    for (const line of prompt.split("\n")) {
        if (line.length === 0) {
            chunks.push("\n");
            continue;
        }
        let remaining = line;
        while (remaining.length > 96) {
            let boundary = remaining.lastIndexOf(" ", 96);
            if (boundary < 40) boundary = 96;
            chunks.push(`${remaining.slice(0, boundary)} `);
            remaining = remaining.slice(boundary).trimStart();
        }
        chunks.push(`${remaining}\n`);
    }
    chunks[chunks.length - 1] = chunks.at(-1).replace(/\n$/u, "");
    return [
        "// Captured from Grok CLI 0.2.111 for Grok 4.5.",
        "export const grok_4_5_system_prompt =",
        ...chunks.map(
            (chunk, index) =>
                `    ${JSON.stringify(chunk)}${index === chunks.length - 1 ? ";" : " +"}`,
        ),
        "",
    ].join("\n");
}

function formatTool(tool) {
    return [
        'import { Type } from "@sinclair/typebox";',
        "",
        'import type { SessionTool } from "@/core/SessionTool.js";',
        "",
        `export const ${tool.name} = {`,
        `    name: ${JSON.stringify(tool.name)},`,
        '    type: "local",',
        ...(tool.description === undefined
            ? []
            : [`    description: ${JSON.stringify(tool.description)},`]),
        `    parameters: ${schemaExpression(tool.parameters, 1)},`,
        "} as const satisfies SessionTool;",
        "",
    ].join("\n");
}

function schemaExpression(schema, depth) {
    const options = schemaOptions(schema);
    if (Array.isArray(schema.type)) return `Type.Unsafe(${prettyObject(schema, depth)})`;
    if (Array.isArray(schema.enum)) {
        const hasNonString = schema.enum.some((value) => typeof value !== "string");
        if (hasNonString) return `Type.Unsafe(${prettyObject(schema, depth)})`;
        return `Type.String(${prettyObject({ ...options, enum: schema.enum }, depth)})`;
    }
    if (schema.type === "object") {
        if (schema.properties === undefined) return `Type.Unsafe(${prettyObject(schema, depth)})`;
        const required = new Set(schema.required ?? []);
        const properties = Object.entries(schema.properties ?? {}).map(([name, child]) => {
            const expression = schemaExpression(child, depth + 1);
            return `${JSON.stringify(name)}: ${required.has(name) ? expression : `Type.Optional(${expression})`}`;
        });
        const body =
            properties.length === 0
                ? "{}"
                : `{\n${properties
                      .map((property) => `${"    ".repeat(depth + 1)}${property},`)
                      .join("\n")}\n${"    ".repeat(depth)}}`;
        return `Type.Object(${body}${optionArgument(options, depth)})`;
    }
    if (schema.type === "array") {
        return `Type.Array(${schemaExpression(schema.items ?? {}, depth + 1)}${optionArgument(options, depth)})`;
    }
    if (schema.type === "string") return `Type.String(${prettyObject(options, depth)})`;
    if (schema.type === "integer") return `Type.Integer(${prettyObject(options, depth)})`;
    if (schema.type === "number") return `Type.Number(${prettyObject(options, depth)})`;
    if (schema.type === "boolean") return `Type.Boolean(${prettyObject(options, depth)})`;
    if (schema.type === "null") return "Type.Null()";
    return `Type.Unknown(${prettyObject(options, depth)})`;
}

function schemaOptions(schema) {
    const options = Object.fromEntries(
        Object.entries(schema).filter(
            ([key]) => !["type", "properties", "items", "required", "enum"].includes(key),
        ),
    );
    if (Array.isArray(schema.required) && schema.required.length === 0) options.required = [];
    return options;
}

function optionArgument(options, depth) {
    return Object.keys(options).length === 0 ? "" : `, ${prettyObject(options, depth)}`;
}

function prettyObject(value, depth) {
    if (Object.keys(value).length === 0) return "{}";
    const indentation = "    ".repeat(depth);
    return JSON.stringify(value, null, 4)
        .split("\n")
        .map((line, index) => (index === 0 ? line : `${indentation}${line}`))
        .join("\n");
}

function formatToolIndex(tools) {
    return [
        'import type { SessionTool } from "@/core/SessionTool.js";',
        ...tools.map(
            (tool) => `import { ${tool.name} } from "@/vendors/grok/tools/${tool.name}.js";`,
        ),
        "",
        "export const grok_4_5_tools: readonly SessionTool[] = [",
        ...tools.map((tool) => `    ${tool.name},`),
        "];",
        "",
    ].join("\n");
}
