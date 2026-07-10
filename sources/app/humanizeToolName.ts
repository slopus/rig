export function humanizeToolName(name: string): string {
    if (name === "Agent") return "Subagent";
    const normalized = name.toLowerCase();
    if (normalized === "request_user_input" || normalized === "askuserquestion") {
        return "Question";
    }
    if (normalized === "tasklist") return "Task list";
    if (normalized === "taskcreate" || normalized === "taskget" || normalized === "taskupdate") {
        return "Task";
    }
    const parts = name.startsWith("mcp__") ? name.slice("mcp__".length).split("__") : [];
    if (parts.length >= 2) {
        return `${humanizeWords(parts[0] ?? "MCP")} · ${humanizeWords(parts.slice(1).join("__"))}`;
    }
    return name;
}

function humanizeWords(value: string): string {
    return value
        .replace(/[_-]+/g, " ")
        .trim()
        .replace(/\b\w/g, (character) => character.toUpperCase());
}
