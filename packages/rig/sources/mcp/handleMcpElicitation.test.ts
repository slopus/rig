import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ElicitRequest } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { handleMcpElicitation } from "./handleMcpElicitation.js";
import { runMcpClientCall } from "./runMcpClientCall.js";

describe("handleMcpElicitation", () => {
    it("collects free-form values and preserves raw enum values", async () => {
        const client = {} as Client;
        const harness = createJustBashToolHarness();
        harness.context.userInput = {
            request: async () => ({
                answers: { count: ["42"], environment: ["Production environment"] },
            }),
        };
        const request = {
            method: "elicitation/create",
            params: {
                message: "Configure deployment.",
                requestedSchema: {
                    type: "object",
                    properties: {
                        count: { type: "integer", title: "Count" },
                        environment: {
                            type: "string",
                            enum: ["staging", "production"],
                            enumNames: ["Staging environment", "Production environment"],
                        },
                    },
                    required: ["count", "environment"],
                },
            },
        } as ElicitRequest;

        const result = await runMcpClientCall(client, harness.context, () =>
            handleMcpElicitation(client, request),
        );

        expect(result).toEqual({
            action: "accept",
            content: { count: 42, environment: "production" },
        });
    });

    it("asks for confirmation before accepting an empty schema", async () => {
        const client = {} as Client;
        const harness = createJustBashToolHarness();
        const requests: unknown[] = [];
        harness.context.userInput = {
            request: async (request) => {
                requests.push(request);
                return { answers: { confirmation: ["Continue"] } };
            },
        };
        const request = emptySchemaRequest("Proceed with deleting remote records?");

        const result = await runMcpClientCall(client, harness.context, () =>
            handleMcpElicitation(client, request),
        );

        expect(result).toEqual({ action: "accept", content: {} });
        expect(requests).toMatchObject([
            {
                questions: [
                    {
                        header: "MCP request",
                        id: "confirmation",
                        options: [{ label: "Continue" }, { label: "Decline" }],
                        question: "Proceed with deleting remote records?",
                    },
                ],
            },
        ]);
    });

    it("declines an empty schema when the user does not confirm", async () => {
        const client = {} as Client;
        const harness = createJustBashToolHarness();
        harness.context.userInput = {
            request: async () => ({ answers: { confirmation: ["Decline"] } }),
        };

        const result = await runMcpClientCall(client, harness.context, () =>
            handleMcpElicitation(client, emptySchemaRequest("Continue?")),
        );

        expect(result).toEqual({ action: "decline" });
    });
});

function emptySchemaRequest(message: string): ElicitRequest {
    return {
        method: "elicitation/create",
        params: {
            message,
            requestedSchema: { type: "object", properties: {} },
        },
    } as ElicitRequest;
}
