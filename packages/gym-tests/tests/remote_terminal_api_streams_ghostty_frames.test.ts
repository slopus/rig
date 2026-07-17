import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("remote terminal API", () => {
    it("streams a real PTY as Ghostty frames and retains scrollback", async () => {
        const gym = await createGym({
            files: { "remote-terminal-client.mjs": REMOTE_TERMINAL_CLIENT },
        });
        running.add(gym);

        const { stdout } = await gym.runInContainer("node", ["remote-terminal-client.mjs"], {
            timeoutMs: 60_000,
        });
        const result = JSON.parse(stdout) as {
            finalStatus: string;
            greenStyled: boolean;
            revisions: number[];
            text: string;
            totalRows: number;
        };

        expect(result.finalStatus).toBe("exited");
        expect(result.greenStyled).toBe(true);
        expect(result.revisions.length).toBeGreaterThan(0);
        expect(result.revisions).toEqual([...result.revisions].sort((left, right) => left - right));
        expect(result.text).toContain("reply:hello");
        expect(result.text).toContain("history-4");
        expect(result.totalRows).toBeGreaterThan(3);
    }, 120_000);
});

const REMOTE_TERMINAL_CLIENT = String.raw`
import { readFile } from "node:fs/promises";
import { request } from "node:http";

const directory = "/tmp/rig-" + process.getuid();
const socketPath = directory + "/server.sock";
const token = (await readFile(directory + "/token", "utf8")).trim();

function requestJson(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = request({
            socketPath,
            method,
            path,
            headers: {
                authorization: "Bearer " + token,
                accept: "application/json",
                ...(payload === undefined ? {} : {
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(payload),
                }),
            },
        }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            response.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                if ((response.statusCode ?? 500) >= 400) {
                    reject(new Error(text));
                    return;
                }
                resolve(text.length === 0 ? {} : JSON.parse(text));
            });
        });
        req.on("error", reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

function waitForExit(sessionId, terminalId, after, revisions) {
    return new Promise((resolve, reject) => {
        const req = request({
            socketPath,
            method: "GET",
            path: "/sessions/" + encodeURIComponent(sessionId) + "/terminals/" +
                encodeURIComponent(terminalId) + "/stream?after=" + after,
            headers: {
                authorization: "Bearer " + token,
                accept: "text/event-stream",
            },
        }, (response) => {
            if ((response.statusCode ?? 500) >= 400) {
                reject(new Error("Stream failed with HTTP " + response.statusCode));
                response.resume();
                return;
            }
            let buffer = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
                buffer += chunk;
                for (;;) {
                    const boundary = buffer.indexOf("\n\n");
                    if (boundary < 0) break;
                    const raw = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const data = raw.split("\n").find((line) => line.startsWith("data: "));
                    if (data === undefined) continue;
                    const frame = JSON.parse(data.slice(6));
                    revisions.push(frame.revision);
                    if (frame.status === "exited") resolve(frame);
                }
            });
            response.on("error", reject);
        });
        req.on("error", reject);
        req.end();
    });
}

function rowText(row) {
    const cells = Array.from({ length: 200 }, () => " ");
    let width = 0;
    for (const cell of row.cells) {
        cells[cell.x] = cell.text;
        width = Math.max(width, cell.x + cell.width);
    }
    return cells.slice(0, width).join("").trimEnd();
}

const sessions = await requestJson("GET", "/sessions");
const sessionId = sessions.sessions[0].id;
const created = await requestJson("POST", "/sessions/" + encodeURIComponent(sessionId) + "/terminals", {
    cols: 30,
    rows: 3,
    command: "printf '\\033[32mhistory-1\\033[0m\\nhistory-2\\nhistory-3\\nhistory-4\\n'; IFS= read -r value; printf 'reply:%s\\n' \"$value\"",
});
const revisions = [];
const exited = waitForExit(sessionId, created.terminal.id, created.terminal.revision, revisions);
await requestJson("POST", "/sessions/" + encodeURIComponent(sessionId) + "/terminals/" +
    encodeURIComponent(created.terminal.id) + "/input", { data: "hello\n" });
const finalFrame = await exited;
const history = await requestJson("GET", "/sessions/" + encodeURIComponent(sessionId) +
    "/terminals/" + encodeURIComponent(created.terminal.id) + "/scrollback?start=0&limit=20");
const cells = history.viewport.rows.flatMap((row) => row.cells);
process.stdout.write(JSON.stringify({
    finalStatus: finalFrame.status,
    greenStyled: cells.some((cell) => cell.text === "h" && cell.style.foreground?.kind === "palette" &&
        cell.style.foreground.index === 2),
    revisions,
    text: history.viewport.rows.map(rowText).join("\n"),
    totalRows: history.viewport.totalRows,
}));
`;
