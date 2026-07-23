import { Type, type TSchema } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { defineTool, type AnyDefinedTool } from "../../types.js";
import { searchToolDefinitions } from "./searchToolDefinitions.js";

function defineTestTool(options: {
    arguments?: TSchema;
    description: string;
    name: string;
    searchText?: string;
}): AnyDefinedTool {
    return defineTool({
        name: options.name,
        label: options.name,
        description: options.description,
        ...(options.searchText === undefined ? {} : { searchText: options.searchText }),
        arguments: options.arguments ?? Type.Object({}),
        returnType: Type.Null(),
        execute: () => null,
        toLLM: () => [],
        toUI: () => options.name,
        shouldReviewInAutoMode: () => false,
        locks: [],
    });
}

describe("searchToolDefinitions", () => {
    const tools = [
        defineTestTool({
            name: "calendar_create_event",
            description: "Create a meeting on a calendar.",
            arguments: Type.Object({
                timezone: Type.String({ description: "IANA timezone for the event." }),
            }),
        }),
        defineTestTool({
            name: "repository_search",
            description: "Find source code in a repository.",
            arguments: Type.Object({ query: Type.String() }),
        }),
        defineTestTool({
            name: "music_lookup",
            description: "Find songs and albums.",
        }),
    ] as const;

    it("returns the original defined tools in relevance order", () => {
        const results = searchToolDefinitions(tools, "create calendar meeting");

        expect(results).toEqual([tools[0]]);
        expect(results[0]).toBe(tools[0]);
    });

    it("searches argument names and descriptions", () => {
        expect(searchToolDefinitions(tools, "IANA timezones")).toEqual([tools[0]]);
    });

    it("supports Codex-style custom search text on defined tools", () => {
        const customTool = defineTestTool({
            name: "opaque_action",
            description: "Perform an action.",
            searchText: "deploy release production ship launch",
        });
        const customTools = [...tools, customTool];

        expect(searchToolDefinitions(customTools, "ship production")).toEqual([customTool]);
        expect(searchToolDefinitions(customTools, "opaque action")).toEqual([]);
    });

    it("stems words and applies the requested limit", () => {
        expect(searchToolDefinitions(tools, "finding", 1)).toEqual([tools[2]]);
    });

    it("returns no tools when no terms match", () => {
        expect(searchToolDefinitions(tools, "weather forecast")).toEqual([]);
    });

    it("rejects invalid search arguments", () => {
        expect(() => searchToolDefinitions(tools, " ")).toThrow("query must not be empty");
        expect(() => searchToolDefinitions(tools, "calendar", 0)).toThrow(
            "limit must be greater than zero",
        );
        expect(() => searchToolDefinitions(tools, "calendar", 1.5)).toThrow(
            "limit must be a positive integer",
        );
    });
});
