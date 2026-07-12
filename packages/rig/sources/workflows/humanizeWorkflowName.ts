export function humanizeWorkflowName(name: string): string {
    const words = name.replace(/[_-]+/g, " ").trim().toLowerCase();
    return words.length === 0
        ? "Workflow"
        : words.replace(/^./u, (character) => character.toUpperCase());
}
