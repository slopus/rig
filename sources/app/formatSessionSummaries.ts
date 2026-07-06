import type { SessionStatus, SessionSummary } from "../protocol/index.js";

export function formatSessionSummaries(
    sessions: readonly SessionSummary[],
    options: { columns: number; rows: number },
): readonly string[] {
    const visibleRows = Math.max(0, options.rows);
    if (visibleRows === 0) {
        return [];
    }

    if (sessions.length === 0) {
        return [truncate("No sessions.", options.columns)];
    }

    const limit = Math.max(0, visibleRows - 1);
    const lines = [
        truncate("STATUS     LAST MESSAGE      SESSION ID              TITLE", options.columns),
    ];
    for (const session of sessions.slice(0, limit)) {
        lines.push(truncate(formatSessionSummary(session), options.columns));
    }
    return lines;
}

function formatSessionSummary(session: SessionSummary): string {
    return [
        padRight(humanizeStatus(session.status), 10),
        padRight(formatTimestamp(session.lastMessageAt), 17),
        padRight(session.id, 23),
        titleText(session),
    ].join(" ");
}

function formatTimestamp(value: number | undefined): string {
    if (value === undefined) {
        return "No messages";
    }

    const date = new Date(value);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hour}:${minute}`;
}

function humanizeStatus(status: SessionStatus): string {
    if (status === "idle") return "Idle";
    if (status === "queued") return "Queued";
    if (status === "running") return "Running";
    if (status === "completed") return "Completed";
    if (status === "aborted") return "Aborted";
    return "Error";
}

function padRight(value: string, length: number): string {
    return value.length >= length ? value : `${value}${" ".repeat(length - value.length)}`;
}

function titleText(session: SessionSummary): string {
    if (session.title !== undefined && session.title.length > 0) {
        return session.title;
    }
    if (session.titleStatus === "generating") {
        return "Generating title";
    }
    return "Untitled session";
}

function truncate(value: string, columns: number): string {
    if (columns <= 0) {
        return "";
    }
    if (value.length <= columns) {
        return value;
    }
    if (columns === 1) {
        return "…";
    }
    return `${value.slice(0, columns - 1)}…`;
}
