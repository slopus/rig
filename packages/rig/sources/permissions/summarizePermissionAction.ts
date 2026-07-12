export function summarizePermissionAction(toolName: string, args: unknown): string {
    if (args !== null && typeof args === "object") {
        const record = args as Record<string, unknown>;
        const command = readString(record, "cmd") ?? readString(record, "command");
        if (command !== undefined) return `running “${singleLine(command)}”`;
        const url = readString(record, "url");
        if (url !== undefined) return `accessing ${singleLine(url)}`;
        const path = readString(record, "file_path") ?? readString(record, "path");
        if (path !== undefined) return `using ${singleLine(path)}`;
    }
    return `the ${humanize(toolName)} action`;
}

function humanize(value: string): string {
    return value
        .replaceAll("_", " ")
        .replace(/([a-z])([A-Z])/gu, "$1 $2")
        .toLowerCase();
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function singleLine(value: string): string {
    return value.replace(/\s+/gu, " ").trim();
}
