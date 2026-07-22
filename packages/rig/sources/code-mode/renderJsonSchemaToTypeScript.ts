export function renderJsonSchemaToTypeScript(schema: unknown): string {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return "unknown";
    const value = schema as Record<string, unknown>;
    if (Array.isArray(value.anyOf)) {
        return value.anyOf.map(renderJsonSchemaToTypeScript).join(" | ");
    }
    if (Array.isArray(value.oneOf)) {
        return value.oneOf.map(renderJsonSchemaToTypeScript).join(" | ");
    }
    if (Array.isArray(value.enum)) {
        return value.enum.map(renderLiteral).join(" | ");
    }
    if ("const" in value) return renderLiteral(value.const);
    if (Array.isArray(value.type)) {
        return value.type
            .map((type) => renderJsonSchemaToTypeScript({ ...value, type }))
            .join(" | ");
    }
    switch (value.type) {
        case "string":
            return "string";
        case "number":
        case "integer":
            return "number";
        case "boolean":
            return "boolean";
        case "null":
            return "null";
        case "array":
            return `Array<${renderJsonSchemaToTypeScript(value.items)}>`;
        case "object":
        default:
            return renderObject(value);
    }
}

function renderObject(schema: Record<string, unknown>): string {
    const properties =
        typeof schema.properties === "object" &&
        schema.properties !== null &&
        !Array.isArray(schema.properties)
            ? (schema.properties as Record<string, unknown>)
            : undefined;
    if (properties === undefined) {
        return schema.additionalProperties === true ? "Record<string, unknown>" : "unknown";
    }
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const fields = Object.entries(properties).map(
        ([name, property]) =>
            `${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${renderJsonSchemaToTypeScript(property)};`,
    );
    return `{ ${fields.join(" ")} }`;
}

function renderLiteral(value: unknown): string {
    return value === undefined ? "undefined" : JSON.stringify(value);
}
