import { randomUUID } from "node:crypto";

import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { getMcpClientAgentContext } from "./runMcpClientCall.js";

export async function handleMcpElicitation(
    client: Client,
    request: ElicitRequest,
): Promise<ElicitResult> {
    if (!("requestedSchema" in request.params)) return { action: "decline" };
    const { message, requestedSchema } = request.params;
    const userInput = getMcpClientAgentContext(client)?.userInput;
    if (userInput === undefined) return { action: "decline" };

    const entries = Object.entries(requestedSchema.properties);
    const valuesByLabel = new Map<string, Map<string, string>>();
    const questions = entries.map(([id, property]) => {
        const enumValues =
            "enum" in property && Array.isArray(property.enum)
                ? property.enum
                : "oneOf" in property && Array.isArray(property.oneOf)
                  ? property.oneOf.map((item) => item.const)
                  : property.type === "array" && "items" in property && "enum" in property.items
                    ? property.items.enum
                    : property.type === "array" && "items" in property && "anyOf" in property.items
                      ? property.items.anyOf.map((item) => item.const)
                      : property.type === "boolean"
                        ? ["true", "false"]
                        : [];
        const enumNames =
            "enumNames" in property && Array.isArray(property.enumNames)
                ? property.enumNames
                : "oneOf" in property && Array.isArray(property.oneOf)
                  ? property.oneOf.map((item) => item.title)
                  : property.type === "array" && "items" in property && "anyOf" in property.items
                    ? property.items.anyOf.map((item) => item.title)
                    : enumValues;
        valuesByLabel.set(
            id,
            new Map(enumValues.map((value, index) => [enumNames[index] ?? value, value])),
        );
        const required = requestedSchema.required?.includes(id) === true;
        const header = (property.title ?? id).trim();
        return {
            header: header.length > 12 ? `${header.slice(0, 11).trimEnd()}…` : header,
            id,
            multiSelect: property.type === "array",
            options: [
                ...enumValues.map((value, index) => ({
                    label: enumNames[index] ?? value,
                    description: property.description ?? `Use ${value}.`,
                })),
                ...(enumValues.length === 0 && !required
                    ? [{ label: "Skip", description: "Leave this optional value unset." }]
                    : []),
            ],
            question: property.description ?? message,
        };
    });
    if (questions.length === 0) {
        const response = await userInput.request({
            requestId: `mcp:${randomUUID()}`,
            questions: [
                {
                    header: "MCP request",
                    id: "confirmation",
                    multiSelect: false,
                    options: [
                        {
                            label: "Continue",
                            description: "Accept this request without providing additional values.",
                        },
                        {
                            label: "Decline",
                            description: "Reject this request.",
                        },
                    ],
                    question: message,
                },
            ],
        });
        return response.answers.confirmation?.includes("Continue") === true
            ? { action: "accept", content: {} }
            : { action: "decline" };
    }

    const response = await userInput.request({ requestId: `mcp:${randomUUID()}`, questions });
    const content: Record<string, string | number | boolean | string[]> = {};
    for (const [id, property] of entries) {
        const answers = response.answers[id] ?? [];
        if (answers.includes("Skip")) continue;
        const normalized = answers.map((answer) => valuesByLabel.get(id)?.get(answer) ?? answer);
        const raw = property.type === "array" ? normalized : normalized[0];
        if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
            if (requestedSchema.required?.includes(id) === true) {
                return { action: "decline" };
            }
            continue;
        }
        if (property.type === "boolean" && typeof raw === "string") {
            content[id] = raw === "true";
        } else if (
            (property.type === "number" || property.type === "integer") &&
            typeof raw === "string"
        ) {
            const number = Number(raw);
            if (!Number.isFinite(number)) return { action: "decline" };
            content[id] = number;
        } else {
            content[id] = raw;
        }
    }
    return { action: "accept", content };
}
