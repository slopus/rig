import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

export function claudeResultErrorMessage(
    result: Exclude<SDKResultMessage, { subtype: "success" }>,
): string {
    const errors = result.errors.map((error) => error.trim()).filter((error) => error.length > 0);
    if (errors.length > 0) return errors.join("\n");

    switch (result.subtype) {
        case "error_during_execution":
            return "Claude encountered an error while running the request.";
        case "error_max_turns":
            return "Claude reached the maximum number of turns.";
        case "error_max_budget_usd":
            return "Claude reached the configured spending limit.";
        case "error_max_structured_output_retries":
            return "Claude could not produce valid structured output after repeated attempts.";
    }
}
