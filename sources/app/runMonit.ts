import { ensureLocalProtocolServer } from "../client/index.js";
import { formatSessionSummaries } from "./formatSessionSummaries.js";

export interface RunMonitOptions {
    columns?: number;
    rows?: number;
}

export async function runMonit(options: RunMonitOptions = {}): Promise<void> {
    const rows = options.rows ?? process.stdout.rows ?? 24;
    const columns = options.columns ?? process.stdout.columns ?? 100;
    const limit = Math.max(0, rows - 1);
    const localServer = await ensureLocalProtocolServer();
    const response = await localServer.client.listSessions(limit);
    const lines = formatSessionSummaries(response.sessions, { columns, rows });
    for (const line of lines) {
        console.log(line);
    }
}
