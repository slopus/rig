import { humanizeMcpName } from "../mcp/humanizeMcpName.js";

export function summarizePermissionAction(toolName: string, args: unknown): string {
    if (args !== null && typeof args === "object") {
        const record = args as Record<string, unknown>;
        const mcpAction = summarizeMcpAction(toolName, record);
        if (mcpAction !== undefined) return mcpAction;
        if (toolName === "write_stdin") {
            const chars = readString(record, "chars");
            const sessionId = readNumber(record, "session_id");
            if (chars !== undefined && sessionId !== undefined) {
                return `sending ${quoteVisibleExact(chars)} to shell session ${sessionId}`;
            }
        }
        const command = readString(record, "cmd") ?? readString(record, "command");
        if (command !== undefined) {
            const secrets = readStringArray(record, "secrets");
            const secretSuffix =
                secrets.length === 0
                    ? ""
                    : ` with ${secrets.length === 1 ? "secret" : "secrets"} ${secrets.map(quoteVisibleExact).join(", ")}`;
            return `running ${quoteVisibleExact(command)}${secretSuffix}`;
        }
        const url = readString(record, "url");
        if (url !== undefined) return `accessing ${singleLine(url)}`;
        const path = readString(record, "file_path") ?? readString(record, "path");
        if (path !== undefined) return `using ${singleLine(path)}`;
    }
    return `the ${humanize(toolName)} action`;
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] {
    const value = record[key];
    return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
}

function summarizeMcpAction(toolName: string, record: Record<string, unknown>): string | undefined {
    if (toolName === "call_mcp_tool") {
        const server = readString(record, "server");
        const name = readString(record, "name");
        if (server === undefined || name === undefined) return undefined;
        return mcpAction(humanizeMcpName(server), humanizeMcpName(name), record.arguments);
    }
    if (!toolName.startsWith("mcp__")) return undefined;
    const separator = toolName.indexOf("__", "mcp__".length);
    if (separator < 0) return undefined;
    const server = toolName.slice("mcp__".length, separator);
    const name = toolName.slice(separator + 2);
    return mcpAction(humanizeMcpName(server), humanizeMcpName(name), record);
}

function mcpAction(server: string, name: string, args: unknown): string {
    const serialized = JSON.stringify(args ?? {});
    return `calling ${quoteVisibleExact(name)} from ${quoteVisibleExact(server)} with arguments ${quoteVisibleExact(serialized)}. Access: the MCP server can perform actions outside Rig’s filesystem sandbox`;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

export function quoteVisibleExact(value: string): string {
    let visible = "";
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        if (character === "\\") visible += "\\\\";
        else if (character === '"') visible += '\\"';
        else if (character === "\n") visible += "\\n";
        else if (character === "\r") visible += "\\r";
        else if (character === "\t") visible += "\\t";
        else if (
            codePoint < 0x20 ||
            codePoint === 0x7f ||
            (codePoint >= 0x202a && codePoint <= 0x202e) ||
            (codePoint >= 0x2066 && codePoint <= 0x2069)
        ) {
            visible += `\\u{${codePoint.toString(16).padStart(4, "0")}}`;
        } else {
            visible += character;
        }
    }
    return `"${visible}"`;
}
