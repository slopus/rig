#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(packageRoot, "../..");
const profileRoot = resolve(repositoryRoot, "packages/rig/sources/profiles/claude");
const promptRoot = resolve(packageRoot, "sources/vendors/claude/prompts");
const toolRoot = resolve(packageRoot, "sources/vendors/claude/tools");
await Promise.all([mkdir(promptRoot, { recursive: true }), mkdir(toolRoot, { recursive: true })]);

const prompts = [
    ["claude-fable-5.md", "claude_fable_5_system_prompt"],
    ["claude-opus-4-8.md", "claude_opus_4_8_system_prompt"],
    ["claude-sonnet-5.md", "claude_sonnet_5_system_prompt"],
];
for (const [fileName, exportName] of prompts) {
    const prompt = await readFile(resolve(profileRoot, fileName), "utf8");
    await writeFile(
        resolve(promptRoot, `${exportName}.ts`),
        `export const ${exportName} = \`\\\n${toTemplateLiteral(prompt)}\`;\n`,
    );
}

const baseTools = JSON.parse(
    await readFile(resolve(profileRoot, "claude-opus-4-8.tools.json"), "utf8"),
);
const sonnetTools = JSON.parse(
    await readFile(resolve(profileRoot, "claude-sonnet-5.tools.json"), "utf8"),
);
const exports = [];
for (const baseTool of baseTools) {
    const sonnetTool = sonnetTools.find((tool) => tool.name === baseTool.name);
    if (sonnetTool === undefined) throw new Error(`Missing Sonnet tool '${baseTool.name}'.`);
    const stem = baseTool.name.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
    const exportName = `claude_${stem}_tool`;
    exports.push({ exportName, stem });
    await writeFile(
        resolve(toolRoot, `${stem}.ts`),
        `import { Type } from "@sinclair/typebox";\n\nimport type { SessionTool } from "@/core/SessionTool.js";\n\nexport const ${exportName}: SessionTool = {\n    name: ${JSON.stringify(baseTool.name)},\n    type: "local",\n    description: ${JSON.stringify(baseTool.description)},\n    parameters: ${toTypeBox(baseTool.input_schema)},\n};\n\nexport const ${exportName}_sonnet: SessionTool = {\n    name: ${JSON.stringify(sonnetTool.name)},\n    type: "local",\n    description: ${JSON.stringify(sonnetTool.description)},\n    parameters: ${toTypeBox(sonnetTool.input_schema)},\n};\n`,
    );
}

await writeFile(
    resolve(toolRoot, "index.ts"),
    `${exports
        .map(
            ({ exportName, stem }) =>
                `import { ${exportName}, ${exportName}_sonnet } from "@/vendors/claude/tools/${stem}.js";`,
        )
        .join("\n")}

export const claude_tools = [
${exports.map(({ exportName }) => `    ${exportName},`).join("\n")}
] as const;

export const claude_sonnet_tools = [
${exports.map(({ exportName }) => `    ${exportName}_sonnet,`).join("\n")}
] as const;
`,
);

function toTypeBox(schema, required = true) {
    const options = Object.fromEntries(
        Object.entries(schema).filter(
            ([key]) =>
                ![
                    "$schema",
                    "type",
                    "properties",
                    "required",
                    "items",
                    "anyOf",
                    "enum",
                    "const",
                ].includes(key),
        ),
    );
    let expression;
    if (Object.prototype.hasOwnProperty.call(schema, "const")) {
        expression = call("Literal", [JSON.stringify(schema.const), options]);
    } else if (Array.isArray(schema.enum)) {
        expression = call("Union", [
            `[${schema.enum.map((value) => `Type.Literal(${JSON.stringify(value)})`).join(", ")}]`,
            options,
        ]);
    } else if (Array.isArray(schema.anyOf)) {
        expression = call("Union", [
            `[${schema.anyOf.map((item) => toTypeBox(item)).join(", ")}]`,
            options,
        ]);
    } else if (schema.type === "object") {
        const requiredNames = new Set(schema.required ?? []);
        const properties = Object.entries(schema.properties ?? {})
            .map(
                ([name, property]) =>
                    `${JSON.stringify(name)}: ${toTypeBox(property, requiredNames.has(name))}`,
            )
            .join(", ");
        expression = call("Object", [`{ ${properties} }`, options]);
    } else if (schema.type === "array") {
        expression = call("Array", [toTypeBox(schema.items ?? {}), options]);
    } else if (schema.type === "string") {
        expression = call("String", [options]);
    } else if (schema.type === "integer") {
        expression = call("Integer", [options]);
    } else if (schema.type === "number") {
        expression = call("Number", [options]);
    } else if (schema.type === "boolean") {
        expression = call("Boolean", [options]);
    } else if (schema.type === "null") {
        expression = call("Null", [options]);
    } else {
        expression = call("Unknown", [options]);
    }
    return required ? expression : `Type.Optional(${expression})`;
}

function call(name, arguments_) {
    const normalized = arguments_.filter(
        (argument) => typeof argument === "string" || Object.keys(argument).length > 0,
    );
    return `Type.${name}(${normalized
        .map((argument) => (typeof argument === "string" ? argument : serializeOptions(argument)))
        .join(", ")})`;
}

function serializeOptions(options) {
    return JSON.stringify(options).replaceAll(
        /"additionalProperties":\{\}/gu,
        '"additionalProperties":Type.Unknown()',
    );
}

function toTemplateLiteral(value, maximumContentWidth = 88) {
    return value
        .split(/(\n)/u)
        .map((part) => {
            if (part === "\n") return "\n";
            const wrapped = [];
            let remaining = part;
            while (escapeTemplateText(remaining).length > maximumContentWidth) {
                const candidate = remaining.slice(0, maximumContentWidth);
                const boundary = candidate.lastIndexOf(" ");
                const length = boundary >= 40 ? boundary + 1 : maximumContentWidth;
                wrapped.push(`${escapeTemplateText(remaining.slice(0, length))}\\\n`);
                remaining = remaining.slice(length);
            }
            wrapped.push(escapeTemplateText(remaining));
            return wrapped.join("");
        })
        .join("");
}

function escapeTemplateText(value) {
    return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
}
