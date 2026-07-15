export function getBedrockIncompleteResponseReason(response: unknown): string {
    if (typeof response !== "object" || response === null) return "unknown";
    const details = (response as { incomplete_details?: unknown }).incomplete_details;
    if (typeof details !== "object" || details === null) return "unknown";
    const reason = (details as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : "unknown";
}
