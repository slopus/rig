export function codexModelsShareConfiguration(left: string, right: string): boolean {
    const normalized = [left, right].map((model) => model.replace(/^openai\./u, ""));
    if (normalized[0] === normalized[1]) return true;
    return normalized.every((model) => model === "gpt-5.6-sol" || model === "gpt-5.6-terra");
}
