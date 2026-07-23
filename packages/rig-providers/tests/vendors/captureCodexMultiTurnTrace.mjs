#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { gunzipSync, zstdDecompressSync } from "node:zlib";
import OpenAI from "openai";
import { ResponsesWS } from "openai/resources/responses/ws";

const CODEX_UPSTREAM = "https://chatgpt.com/backend-api/codex";

const outputArgument = process.argv[2];
const transport = process.argv[3] ?? "sse";
const initialModel = process.argv[4] ?? "gpt-5.6-sol";
const switchedModel = process.argv[5] ?? "gpt-5.6-terra";
const supportedModels = new Set(["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
if (outputArgument === undefined)
    throw new Error(
        "Usage: node captureCodexMultiTurnTrace.mjs <output.json> " +
            "[sse|websocket] [initial-model] [switched-model]",
    );
if (transport !== "sse" && transport !== "websocket")
    throw new Error(`Unsupported transport '${transport}'.`);
if (!supportedModels.has(initialModel) || !supportedModels.has(switchedModel))
    throw new Error(`Unsupported model switch '${initialModel}' -> '${switchedModel}'.`);

const outputPath = resolve(outputArgument);
const captureDirectory = await mkdtemp(`${tmpdir()}/rig-codex-multiturn-sse-`);
const isolatedCodexHome = join(captureDirectory, "codex-home");
await mkdir(isolatedCodexHome);
await copyFile(
    join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "auth.json"),
    join(isolatedCodexHome, "auth.json"),
);
await copyFile(
    join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "models_cache.json"),
    join(isolatedCodexHome, "models_cache.json"),
);

const requests = [];
const responses = [];
const upstreamWebSockets = new Set();
const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
        response.writeHead(404).end();
        return;
    }
    const requestBytes = await readBody(request);
    const body = JSON.parse(decodeRequestBody(requestBytes, request.headers["content-encoding"]));
    requests.push(normalizeRequest(body, captureDirectory));
    const upstream = await fetch(`${CODEX_UPSTREAM}${upstreamPath(request.url)}`, {
        method: "POST",
        headers: upstreamHeaders(request.headers),
        body: requestBytes,
    });
    response.writeHead(upstream.status, relayResponseHeaders(upstream.headers));
    const bytes = Buffer.from(await upstream.arrayBuffer());
    responses.push(summarizeSseResponse(bytes.toString("utf8")));
    response.end(bytes);
});
server.on("upgrade", (request, socket) => {
    if (transport !== "websocket") {
        socket.destroy();
        return;
    }
    acceptWebSocket(request, socket);
    const frames = createFrameReader(socket);
    const upstream = createUpstreamWebSocket(request.headers);
    upstreamWebSockets.add(upstream);
    void (async () => {
        const upstreamEvents = (async () => {
            for await (const item of upstream) {
                if (item.type === "message") {
                    recordWebSocketEvent(item.message);
                    socket.write(encodeTextFrame(JSON.stringify(item.message)));
                } else if (item.type === "close") {
                    socket.end();
                    return;
                } else if (item.type === "error") {
                    throw item.error;
                }
            }
        })();
        for (;;) {
            const body = JSON.parse(await frames.next());
            requests.push(normalizeRequest(body, captureDirectory));
            responses.push({ eventTypes: [], outputItemTypes: [], terminal: null });
            upstream.send(body);
        }
        await upstreamEvents;
    })().catch(() => socket.destroy());
});
server.listen(0, "127.0.0.1");
const port = await listeningPort(server);

const codex = spawn(
    "codex",
    [
        "app-server",
        "--stdio",
        "--config",
        'model_provider="capture"',
        "--config",
        `model="${initialModel}"`,
        "--config",
        'model_reasoning_effort="low"',
        "--config",
        `model_providers.capture={name="OpenAI",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=true,supports_websockets=${transport === "websocket"}}`,
    ],
    {
        env: {
            CODEX_HOME: isolatedCodexHome,
            HOME: homedir(),
            LANG: process.env.LANG ?? "en_US.UTF-8",
            PATH: process.env.PATH,
            TMPDIR: tmpdir(),
        },
        stdio: ["pipe", "pipe", "pipe"],
    },
);

const pending = new Map();
const notifications = [];
let nextId = 1;
let stderr = "";
codex.stderr.setEncoding("utf8");
codex.stderr.on("data", (chunk) => {
    stderr += chunk;
});
createInterface({ input: codex.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
        const { resolve: resolveResponse, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error === undefined) resolveResponse(message.result);
        else reject(new Error(JSON.stringify(message.error)));
        return;
    }
    if (message.method !== undefined) {
        notifications.push(message);
        flushNotificationWaiters();
    }
});

const notificationWaiters = [];

try {
    await rpc("initialize", {
        clientInfo: { name: "rig_trace_capture", title: "Rig trace capture", version: "1" },
        capabilities: { experimentalApi: true },
    });
    notify("initialized");
    const started = await rpc("thread/start", {
        model: initialModel,
        effort: "low",
        cwd: captureDirectory,
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
    });
    const threadId = started.thread.id;
    await runTurn(threadId, "First turn. Reply with exactly FIRST.");
    await runTurn(threadId, "Second turn. Reply with exactly SECOND.");
    await rpc("thread/compact/start", { threadId });
    await waitForNotification(
        (message) =>
            message.method === "item/completed" &&
            message.params?.item?.type === "contextCompaction",
    );
    await waitForNotification(
        (message) => message.method === "turn/completed" && message.params?.threadId === threadId,
    );
    await runTurn(threadId, "After compaction. Reply with exactly SWITCHED.", switchedModel);

    await writeFile(
        outputPath,
        `${JSON.stringify(
            {
                formatVersion: 1,
                source: {
                    client: "codex-app-server",
                    version: await codexVersion(),
                    transport,
                    capture: "forwarded-live-inference",
                },
                scenario: {
                    initialModel,
                    switchedModel,
                    actions: ["turn", "turn", "compact", "turn"],
                    inference: "live",
                },
                requests,
                responses,
            },
            null,
            2,
        )}\n`,
        "utf8",
    );
    process.stdout.write(`Captured ${requests.length} ${transport} requests to ${outputPath}\n`);
} catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
} finally {
    codex.kill("SIGTERM");
    for (const upstream of upstreamWebSockets)
        upstream.close({ code: 1000, reason: "capture complete" });
    upstreamWebSockets.clear();
    server.close();
    await rm(captureDirectory, { force: true, recursive: true });
}

function rpc(method, params) {
    const id = nextId++;
    codex.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolveResponse, reject) => {
        pending.set(id, { resolve: resolveResponse, reject });
    });
}

function notify(method, params = {}) {
    codex.stdin.write(`${JSON.stringify({ method, params })}\n`);
}

async function runTurn(threadId, text, model) {
    const result = await rpc("turn/start", {
        threadId,
        input: [{ type: "text", text }],
        ...(model === undefined ? {} : { model }),
    });
    await waitForNotification(
        (message) =>
            message.method === "turn/completed" &&
            message.params?.threadId === threadId &&
            message.params?.turn?.id === result.turn.id,
    );
}

function waitForNotification(predicate) {
    const existingIndex = notifications.findIndex(predicate);
    if (existingIndex >= 0) return Promise.resolve(notifications.splice(existingIndex, 1)[0]);
    return new Promise((resolveNotification) => {
        notificationWaiters.push({ predicate, resolve: resolveNotification });
    });
}

function flushNotificationWaiters() {
    for (let waiterIndex = notificationWaiters.length - 1; waiterIndex >= 0; waiterIndex -= 1) {
        const waiter = notificationWaiters[waiterIndex];
        const messageIndex = notifications.findIndex(waiter.predicate);
        if (messageIndex < 0) continue;
        notificationWaiters.splice(waiterIndex, 1);
        waiter.resolve(notifications.splice(messageIndex, 1)[0]);
    }
}

function normalizeRequest(request, temporaryDirectory) {
    const normalized = structuredClone(request);
    if ("prompt_cache_key" in normalized) normalized.prompt_cache_key = "<SESSION_ID>";
    if ("previous_response_id" in normalized)
        normalized.previous_response_id = "<PREVIOUS_RESPONSE_ID>";
    delete normalized.client_metadata;
    const stable = JSON.parse(
        JSON.stringify(normalized)
            .replaceAll(temporaryDirectory, "<CAPTURE_DIRECTORY>")
            .replaceAll(homedir(), "<HOME>")
            .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, "<UUID>"),
    );
    replaceEncryptedReasoning(stable);
    return stable;
}

function replaceEncryptedReasoning(value) {
    if (Array.isArray(value)) {
        for (const item of value) replaceEncryptedReasoning(item);
        return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) {
        if (key === "encrypted_content") value[key] = "<ENCRYPTED_REASONING>";
        else replaceEncryptedReasoning(child);
    }
}

function upstreamPath(path) {
    return (path ?? "/responses").replace(/^\/v1(?=\/|$)/u, "");
}

function upstreamHeaders(headers) {
    const forwarded = {};
    for (const [name, value] of Object.entries(headers)) {
        if (
            value === undefined ||
            ["connection", "content-length", "host", "transfer-encoding", "upgrade"].includes(
                name.toLowerCase(),
            )
        )
            continue;
        forwarded[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    return forwarded;
}

function relayResponseHeaders(headers) {
    const relayed = {};
    for (const [name, value] of headers.entries()) {
        if (
            ["connection", "content-encoding", "content-length", "transfer-encoding"].includes(
                name.toLowerCase(),
            )
        )
            continue;
        relayed[name] = value;
    }
    return relayed;
}

function summarizeSseResponse(text) {
    const events = text
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .filter((data) => data !== "[DONE]")
        .flatMap((data) => {
            try {
                return [JSON.parse(data)];
            } catch {
                return [];
            }
        });
    const terminal = events.findLast((event) =>
        ["response.completed", "response.failed", "response.incomplete", "error"].includes(
            event.type,
        ),
    );
    return {
        eventTypes: events.map((event) => event.type),
        outputItemTypes: events
            .filter((event) => event.type === "response.output_item.done")
            .map((event) => event.item?.type)
            .filter((type) => typeof type === "string"),
        terminal: terminal?.type ?? null,
    };
}

function createUpstreamWebSocket(headers) {
    const authorization = headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer "))
        throw new Error("Codex WebSocket request omitted bearer authorization.");
    const client = new OpenAI({
        apiKey: authorization.slice("Bearer ".length),
        baseURL: CODEX_UPSTREAM,
    });
    return new ResponsesWS(client, {
        headers: {
            ...(typeof headers["chatgpt-account-id"] === "string"
                ? { "chatgpt-account-id": headers["chatgpt-account-id"] }
                : {}),
            ...(typeof headers.originator === "string" ? { originator: headers.originator } : {}),
            ...(typeof headers["openai-beta"] === "string"
                ? { "OpenAI-Beta": headers["openai-beta"] }
                : {}),
            ...(typeof headers["session-id"] === "string"
                ? { "session-id": headers["session-id"] }
                : {}),
            ...(typeof headers["x-client-request-id"] === "string"
                ? { "x-client-request-id": headers["x-client-request-id"] }
                : {}),
        },
    });
}

function recordWebSocketEvent(event) {
    const response = responses.at(-1);
    if (response === undefined) return;
    response.eventTypes.push(event.type);
    if (event.type === "response.output_item.done" && typeof event.item?.type === "string")
        response.outputItemTypes.push(event.item.type);
    if (
        ["response.completed", "response.failed", "response.incomplete", "error"].includes(
            event.type,
        )
    )
        response.terminal = event.type;
}

function readBody(request) {
    return new Promise((resolveBody, reject) => {
        const chunks = [];
        request.on("data", (chunk) => {
            chunks.push(chunk);
        });
        request.once("end", () => resolveBody(Buffer.concat(chunks)));
        request.once("error", reject);
    });
}

function decodeRequestBody(bytes, encoding) {
    if (encoding === "zstd") return zstdDecompressSync(bytes).toString("utf8");
    if (encoding === "gzip") return gunzipSync(bytes).toString("utf8");
    if (encoding === undefined || encoding === "identity") return bytes.toString("utf8");
    throw new Error(`Unsupported Codex request content encoding '${encoding}'.`);
}

function listeningPort(httpServer) {
    return new Promise((resolvePort, reject) => {
        httpServer.once("listening", () => {
            const address = httpServer.address();
            if (typeof address !== "object" || address === null)
                reject(new Error("Capture server did not bind a port."));
            else resolvePort(address.port);
        });
        httpServer.once("error", reject);
    });
}

function codexVersion() {
    return new Promise((resolveVersion, reject) => {
        const child = spawn("codex", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) =>
            code === 0
                ? resolveVersion(stdout.trim())
                : reject(new Error(`codex --version exited with ${code}.`)),
        );
    });
}

function acceptWebSocket(request, socket) {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") throw new Error("Missing WebSocket key.");
    import("node:crypto").then(({ createHash }) => {
        const accept = createHash("sha1")
            .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest("base64");
        socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
    });
}

function createFrameReader(socket) {
    let buffer = Buffer.alloc(0);
    const waiting = [];
    const values = [];
    socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
            const frame = takeFrame(buffer);
            if (frame === undefined) break;
            buffer = buffer.subarray(frame.consumed);
            const waiter = waiting.shift();
            if (waiter === undefined) values.push(frame.text);
            else waiter(frame.text);
        }
    });
    return {
        next: () =>
            values.length > 0
                ? Promise.resolve(values.shift())
                : new Promise((resolveFrame) => waiting.push(resolveFrame)),
    };
}

function takeFrame(buffer) {
    if (buffer.length < 2) return undefined;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
        if (buffer.length < 4) return undefined;
        length = buffer.readUInt16BE(2);
        offset = 4;
    } else if (length === 127) {
        if (buffer.length < 10) return undefined;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
    }
    const masked = (buffer[1] & 0x80) !== 0;
    const maskLength = masked ? 4 : 0;
    if (buffer.length < offset + maskLength + length) return undefined;
    const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
    const payloadOffset = offset + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + length));
    if (mask !== undefined)
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    return { consumed: payloadOffset + length, text: payload.toString("utf8") };
}

function encodeTextFrame(value) {
    const payload = Buffer.from(value, "utf8");
    if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
}
