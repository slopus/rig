export function humanizeTaskName(taskName: string): string {
    const words = taskName.replaceAll("_", " ").trim();
    return words.length === 0 ? "Delegated task" : words[0]?.toUpperCase() + words.slice(1);
}
