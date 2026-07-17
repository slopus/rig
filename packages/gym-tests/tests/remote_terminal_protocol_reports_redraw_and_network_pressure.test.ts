import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("remote terminal protocol performance", () => {
    it("reports redraw, typing, slow-reader, reconnect, and scrollback measurements", async () => {
        const gym = await createGym({
            files: {
                "remote-terminal-load.mjs": REMOTE_TERMINAL_LOAD,
                "remote-terminal-benchmark.mjs": REMOTE_TERMINAL_BENCHMARK,
            },
        });
        running.add(gym);

        const { stdout } = await gym.runInContainer("node", ["remote-terminal-benchmark.mjs"], {
            timeoutMs: 120_000,
        });
        const result = JSON.parse(stdout) as BenchmarkResult;

        console.info(`Remote terminal benchmark: ${JSON.stringify(result.metrics, null, 2)}`);

        expect(result.correctness).toMatchObject({
            denseRendered: true,
            reconnectConverged: true,
            slowReaderConverged: true,
            stormTypingRendered: true,
        });
        expect(result.metrics.stream.timeToFirstByteMs).toBeLessThan(2_000);
        expect(result.metrics.stream.timeToFirstFrameMs).toBeLessThan(5_000);
        expect(result.metrics.redraw.denseFrameBytes).toBeGreaterThan(
            result.metrics.redraw.sparseFrameBytes,
        );
        expect(result.metrics.redraw.denseFrameBytes).toBeLessThan(10_000_000);
        expect(result.metrics.redraw.typingLatencyP95Ms).toBeLessThan(5_000);
        expect(result.metrics.pressure.slowReaderFrames).toBeLessThan(
            result.metrics.pressure.redraws,
        );
        expect(result.metrics.pressure.slowReaderConvergenceMs).toBeLessThan(10_000);
        expect(result.metrics.reconnect.catchupMs).toBeLessThan(5_000);
        expect(result.metrics.scrollback.totalRows).toBeGreaterThanOrEqual(500);
        expect(result.metrics.scrollback.fetch500RowsMs).toBeLessThan(5_000);
    }, 180_000);
});

interface BenchmarkResult {
    correctness: {
        denseRendered: boolean;
        reconnectConverged: boolean;
        slowReaderConverged: boolean;
        stormTypingRendered: boolean;
    };
    metrics: {
        pressure: {
            redraws: number;
            slowReaderConvergenceMs: number;
            slowReaderFrames: number;
            stormTypingLatencyMs: number;
        };
        reconnect: { catchupMs: number };
        redraw: {
            denseAmplification: number;
            denseFrameBytes: number;
            densePayloadBytes: number;
            jsonParseP95Ms: number;
            renderP95Ms: number;
            sparseFrameBytes: number;
            typingLatencyP50Ms: number;
            typingLatencyP95Ms: number;
        };
        scrollback: {
            fetch500RowsBytes: number;
            fetch500RowsMs: number;
            requestedLines: number;
            retainedPercent: number;
            totalRows: number;
        };
        stream: { timeToFirstByteMs: number; timeToFirstFrameMs: number };
    };
}

const REMOTE_TERMINAL_LOAD = String.raw`
import { createInterface } from "node:readline";

const COLS = 120;
const ROWS = 40;
let typedMarker = "";

function title(value) {
    return "\u001b]0;" + value + "\u0007";
}

function dense(marker) {
    let output = title(marker) + "\u001b[2J";
    for (let row = 0; row < ROWS; row += 1) {
        const prefix = row === 0 ? marker : row === 1 ? typedMarker : "row-" + row;
        const fill = "abcdefghijklmnopqrstuvwxyz0123456789".repeat(4);
        const text = (prefix + " " + fill).slice(0, COLS).padEnd(COLS, "x");
        output += "\u001b[" + (31 + (row % 7)) + "m\u001b[" + (row + 1) + ";1H" + text;
    }
    output += "\u001b[0m";
    process.stdout.write(output);
    return Buffer.byteLength(output);
}

function sparse(marker) {
    const output = title(marker) + "\u001b[2J\u001b[H" + marker;
    process.stdout.write(output);
    return Buffer.byteLength(output);
}

function storm(count) {
    let index = 0;
    const draw = () => {
        if (index >= count) {
            dense("STORM-DONE");
            return;
        }
        dense("STORM-" + index);
        index += 1;
        setImmediate(draw);
    };
    setImmediate(draw);
}

function history(count) {
    let output = "\u001b[2J\u001b[H";
    for (let index = 0; index < count; index += 1) {
        output += "history-" + String(index).padStart(5, "0") + "\r\n";
    }
    output += title("HISTORY-DONE") + "HISTORY-DONE";
    process.stdout.write(output);
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
    const separator = line.indexOf(":");
    const operation = separator < 0 ? line : line.slice(0, separator);
    const argument = separator < 0 ? "" : line.slice(separator + 1);
    if (operation === "dense") dense(argument);
    else if (operation === "sparse") sparse(argument);
    else if (operation === "storm") storm(Number(argument));
    else if (operation === "type") {
        typedMarker = "TYPE-" + argument;
        dense(typedMarker);
    } else if (operation === "history") history(Number(argument));
    else if (operation === "exit") process.exit(0);
});

sparse("READY");
`;

const REMOTE_TERMINAL_BENCHMARK = String.raw`
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { performance } from "node:perf_hooks";

const directory = "/tmp/rig-" + process.getuid();
const socketPath = directory + "/server.sock";
const token = (await readFile(directory + "/token", "utf8")).trim();

function requestDetailed(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const started = performance.now();
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
            const timeToHeadersMs = performance.now() - started;
            const chunks = [];
            response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            response.on("end", () => {
                const bytes = Buffer.concat(chunks);
                if ((response.statusCode ?? 500) >= 400) {
                    reject(new Error(method + " " + path + ": " + bytes.toString("utf8")));
                    return;
                }
                resolve({
                    bytes: bytes.length,
                    elapsedMs: performance.now() - started,
                    timeToHeadersMs,
                    value: bytes.length === 0 ? {} : JSON.parse(bytes.toString("utf8")),
                });
            });
        });
        req.on("error", reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

async function requestJson(method, path, body) {
    return (await requestDetailed(method, path, body)).value;
}

function renderFrame(frame) {
    let checksum = 0;
    let text = "";
    for (const row of frame.rows) {
        const cells = Array.from({ length: frame.cols }, () => " ");
        for (const cell of row.cells) {
            cells[cell.x] = cell.text;
            checksum = (checksum + cell.x + cell.width + (cell.style.bold ? 7 : 0)) >>> 0;
            const color = cell.style.foreground;
            if (color?.kind === "palette") checksum = (checksum + color.index) >>> 0;
        }
        text += cells.join("") + "\n";
    }
    return { checksum, text };
}

function openStream(sessionId, terminalId, after, startPaused = false) {
    const started = performance.now();
    return new Promise((resolve, reject) => {
        const frames = [];
        const waiters = new Set();
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
            if (startPaused) response.pause();
            let buffer = "";
            let firstByteMs;
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
                if (firstByteMs === undefined) firstByteMs = performance.now() - started;
                buffer += chunk;
                for (;;) {
                    const boundary = buffer.indexOf("\n\n");
                    if (boundary < 0) break;
                    const raw = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const data = raw.split("\n").find((line) => line.startsWith("data: "));
                    if (data === undefined) continue;
                    const parseStarted = performance.now();
                    const frame = JSON.parse(data.slice(6));
                    const parseMs = performance.now() - parseStarted;
                    const renderStarted = performance.now();
                    const rendered = renderFrame(frame);
                    const renderMs = performance.now() - renderStarted;
                    const entry = {
                        bytes: Buffer.byteLength(raw) + 2,
                        frame,
                        parseMs,
                        receivedAt: performance.now(),
                        renderMs,
                        text: rendered.text,
                    };
                    frames.push(entry);
                    for (const waiter of [...waiters]) {
                        if (!waiter.predicate(entry)) continue;
                        waiters.delete(waiter);
                        clearTimeout(waiter.timeout);
                        waiter.resolve(entry);
                    }
                }
            });
            response.on("error", reject);
            const waitFor = (predicate, timeoutMs = 30_000) => {
                const found = frames.find(predicate);
                if (found !== undefined) return Promise.resolve(found);
                return new Promise((waitResolve, waitReject) => {
                    const waiter = {
                        predicate,
                        resolve: waitResolve,
                        timeout: setTimeout(() => {
                            waiters.delete(waiter);
                            waitReject(new Error("Timed out waiting for remote terminal frame."));
                        }, timeoutMs),
                    };
                    waiters.add(waiter);
                });
            };
            resolve({
                close() {
                    req.destroy();
                    response.destroy();
                },
                frames,
                resume() {
                    response.resume();
                },
                started,
                timeToFirstByte: () => firstByteMs,
                waitFor,
            });
        });
        req.on("error", reject);
        req.end();
    });
}

function percentile(values, fraction) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function rounded(value) {
    return Math.round(value * 100) / 100;
}

async function waitForTitle(sessionId, terminalId, title, timeoutMs = 30_000) {
    const started = performance.now();
    for (;;) {
        const current = await requestJson(
            "GET",
            "/sessions/" + encodeURIComponent(sessionId) + "/terminals/" + encodeURIComponent(terminalId),
        );
        if (current.terminal.title === title) return current.terminal;
        if (performance.now() - started >= timeoutMs) {
            throw new Error("Timed out waiting for terminal title " + title);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

const sessions = await requestJson("GET", "/sessions");
const sessionId = sessions.sessions[0].id;
const terminalPath = "/sessions/" + encodeURIComponent(sessionId) + "/terminals";
const created = await requestJson("POST", terminalPath, {
    cols: 120,
    rows: 40,
    maxScrollback: 10_000,
    command: "stty -echo; exec node /workspace/remote-terminal-load.mjs",
});
const terminalId = created.terminal.id;
const itemPath = terminalPath + "/" + encodeURIComponent(terminalId);
const inputPath = itemPath + "/input";

const stream = await openStream(sessionId, terminalId, created.terminal.revision);
const firstFrame = await stream.waitFor((entry) => entry.frame.title === "READY");
const firstByteMs = stream.timeToFirstByte();

const sparseStarted = performance.now();
await requestJson("POST", inputPath, { data: "sparse:SPARSE-BENCH\n" });
const sparse = await stream.waitFor((entry) => entry.frame.title === "SPARSE-BENCH");
const sparseLatency = sparse.receivedAt - sparseStarted;

const denseLatencies = [];
const denseEntries = [];
for (let index = 0; index < 5; index += 1) {
    const marker = "DENSE-BENCH-" + index;
    const started = performance.now();
    await requestJson("POST", inputPath, { data: "dense:" + marker + "\n" });
    const entry = await stream.waitFor((candidate) => candidate.frame.title === marker);
    denseLatencies.push(entry.receivedAt - started);
    denseEntries.push(entry);
}
const representativeDense = denseEntries[Math.floor(denseEntries.length / 2)];
const densePayloadBytes = 120 * 40;

const stormStarted = performance.now();
await requestJson("POST", inputPath, { data: "storm:8\n" });
await requestJson("POST", inputPath, { data: "type:urgent\n" });
const stormTyping = await stream.waitFor((entry) => entry.text.includes("TYPE-urgent"));
const stormTypingLatencyMs = stormTyping.receivedAt - stormStarted;
await stream.waitFor((entry) => entry.frame.title === "STORM-DONE");
stream.close();

const pressureRedraws = 12;
const pressureBase = await requestJson("GET", itemPath);
const slow = await openStream(sessionId, terminalId, pressureBase.terminal.revision, true);
for (let index = 0; index < pressureRedraws; index += 1) {
    await requestJson("POST", inputPath, { data: "dense:PRESSURE-" + index + "\n" });
}
const pressureFinal = await waitForTitle(sessionId, terminalId, "PRESSURE-11");
const resumeStarted = performance.now();
slow.resume();
const slowFinal = await slow.waitFor((entry) => entry.frame.title === "PRESSURE-11");
const slowReaderConvergenceMs = slowFinal.receivedAt - resumeStarted;
const slowReaderFrames = slow.frames.length;
slow.close();

await requestJson("POST", inputPath, { data: "dense:RECONNECT\n" });
const reconnectCurrent = await waitForTitle(sessionId, terminalId, "RECONNECT");
const reconnectStarted = performance.now();
const reconnected = await openStream(
    sessionId,
    terminalId,
    pressureFinal.revision,
);
const reconnectFrame = await reconnected.waitFor((entry) => entry.frame.title === "RECONNECT");
const reconnectCatchupMs = reconnectFrame.receivedAt - reconnectStarted;
reconnected.close();

await requestJson("POST", inputPath, { data: "history:5000\n" });
const historyCurrent = await waitForTitle(sessionId, terminalId, "HISTORY-DONE", 60_000);
const scrollStart = Math.max(0, historyCurrent.totalRows - 500);
const historyFetch = await requestDetailed(
    "GET",
    itemPath + "/scrollback?start=" + scrollStart + "&limit=500",
);

await requestJson("DELETE", itemPath);

const parseTimes = denseEntries.map((entry) => entry.parseMs);
const renderTimes = denseEntries.map((entry) => entry.renderMs);
process.stdout.write(JSON.stringify({
    correctness: {
        denseRendered: representativeDense.text.includes("DENSE-BENCH-2"),
        reconnectConverged: reconnectFrame.frame.revision === reconnectCurrent.revision,
        slowReaderConverged: slowFinal.frame.revision === pressureFinal.revision,
        stormTypingRendered: stormTyping.text.includes("TYPE-urgent"),
    },
    metrics: {
        pressure: {
            redraws: pressureRedraws,
            slowReaderConvergenceMs: rounded(slowReaderConvergenceMs),
            slowReaderFrames,
            stormTypingLatencyMs: rounded(stormTypingLatencyMs),
        },
        reconnect: { catchupMs: rounded(reconnectCatchupMs) },
        redraw: {
            denseAmplification: rounded(representativeDense.bytes / densePayloadBytes),
            denseFrameBytes: representativeDense.bytes,
            densePayloadBytes,
            jsonParseP95Ms: rounded(percentile(parseTimes, 0.95)),
            renderP95Ms: rounded(percentile(renderTimes, 0.95)),
            sparseFrameBytes: sparse.bytes,
            typingLatencyP50Ms: rounded(percentile([sparseLatency, ...denseLatencies], 0.5)),
            typingLatencyP95Ms: rounded(percentile([sparseLatency, ...denseLatencies], 0.95)),
        },
        scrollback: {
            fetch500RowsBytes: historyFetch.bytes,
            fetch500RowsMs: rounded(historyFetch.elapsedMs),
            requestedLines: 5000,
            retainedPercent: rounded((historyCurrent.totalRows / 5000) * 100),
            totalRows: historyCurrent.totalRows,
        },
        stream: {
            timeToFirstByteMs: rounded(firstByteMs),
            timeToFirstFrameMs: rounded(firstFrame.receivedAt - stream.started),
        },
    },
}));
`;
