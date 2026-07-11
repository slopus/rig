export function humanizeToolName(name: string): string {
    if (name === "Agent") return "Subagent";
    const normalized = name.toLowerCase();
    if (normalized === "request_user_input" || normalized === "askuserquestion") {
        return "Question";
    }
    if (normalized === "tasklist") return "Task list";
    if (normalized === "taskoutput") return "Background output";
    if (normalized === "taskstop") return "Stop background command";
    if (normalized === "taskcreate" || normalized === "taskget" || normalized === "taskupdate") {
        return "Task";
    }
    if (normalized === "spawn_agent") return "Start subagent";
    if (normalized === "followup_task") return "Subagent follow-up";
    if (normalized === "wait_agent") return "Wait for subagents";
    if (normalized === "list_agents") return "Subagents";
    if (normalized === "interrupt_agent") return "Stop subagent";
    if (normalized === "sendmessage") return "Subagent follow-up";
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
