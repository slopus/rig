export function humanizePermissionReviewLevel(level: "low" | "medium" | "high"): string {
    if (level === "low") return "Low";
    if (level === "medium") return "Medium";
    return "High";
}
