export function humanizeToolName(name: string): string {
    if (name === "Agent") return "Subagent";
    const normalized = name.toLowerCase();
    if (normalized === "request_user_input" || normalized === "askuserquestion") {
        return "Question";
    }
    return name;
}
