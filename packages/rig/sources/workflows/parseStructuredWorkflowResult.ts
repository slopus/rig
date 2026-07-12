export function parseStructuredWorkflowResult(
    text: string,
    schema: Record<string, unknown>,
): unknown {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
    const candidates = [fenced, text].filter(
        (candidate): candidate is string => candidate !== undefined,
    );
    for (const candidate of candidates) {
        try {
            const value: unknown = JSON.parse(candidate.trim());
            const error = validateJsonSchema(value, schema, "$");
            if (error === undefined) return value;
        } catch {
            // Try the next representation before reporting one useful error.
        }
    }
    throw new Error("The workflow agent did not return JSON matching its schema.");
}

function validateJsonSchema(
    value: unknown,
    schema: Record<string, unknown>,
    path: string,
): string | undefined {
    if (Array.isArray(schema.anyOf)) {
        return schema.anyOf.some(
            (item) => isSchema(item) && validateJsonSchema(value, item, path) === undefined,
        )
            ? undefined
            : `${path} did not match any allowed schema.`;
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
        return `${path} is not an allowed value.`;
    }
    if (Object.prototype.hasOwnProperty.call(schema, "const") && !Object.is(schema.const, value)) {
        return `${path} does not match the required value.`;
    }

    switch (schema.type) {
        case "array": {
            if (!Array.isArray(value)) return `${path} must be an array.`;
            if (isSchema(schema.items)) {
                for (const [index, item] of value.entries()) {
                    const error = validateJsonSchema(item, schema.items, `${path}[${index}]`);
                    if (error !== undefined) return error;
                }
            }
            return undefined;
        }
        case "boolean":
            return typeof value === "boolean" ? undefined : `${path} must be a boolean.`;
        case "integer":
            return Number.isInteger(value) ? undefined : `${path} must be an integer.`;
        case "null":
            return value === null ? undefined : `${path} must be null.`;
        case "number":
            return typeof value === "number" && Number.isFinite(value)
                ? undefined
                : `${path} must be a number.`;
        case "object": {
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
                return `${path} must be an object.`;
            }
            const record = value as Record<string, unknown>;
            if (Array.isArray(schema.required)) {
                for (const key of schema.required) {
                    if (
                        typeof key === "string" &&
                        !Object.prototype.hasOwnProperty.call(record, key)
                    ) {
                        return `${path}.${key} is required.`;
                    }
                }
            }
            if (isSchemaMap(schema.properties)) {
                for (const [key, propertySchema] of Object.entries(schema.properties)) {
                    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
                    const error = validateJsonSchema(record[key], propertySchema, `${path}.${key}`);
                    if (error !== undefined) return error;
                }
            }
            return undefined;
        }
        case "string":
            return typeof value === "string" ? undefined : `${path} must be a string.`;
        default:
            return undefined;
    }
}

function isSchema(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchemaMap(value: unknown): value is Record<string, Record<string, unknown>> {
    return isSchema(value) && Object.values(value).every(isSchema);
}
