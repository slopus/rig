#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const MODEL = "grok-4.5";
const EFFORT = "low";
const GROK_ENDPOINT = "https://cli-chat-proxy.grok.com/v1";
const TURN_PROMPTS = [
    createTurnPrompt("ALPHA", "pnpm test"),
    createTurnPrompt("BETA", "pnpm check"),
    createTurnPrompt("GAMMA", "pnpm build"),
    createTurnPrompt("DELTA", "git diff --check"),
];
const FOLLOW_UP_PROMPT = "List the four checkpoint labels and commands I gave you.";
const outputArgument = process.argv[2];
if (outputArgument === undefined) {
    throw new Error("Usage: node captureGrokCompactionTrace.mjs <output.json>");
}

const outputPath = resolve(outputArgument);
const captureDirectory = await mkdtemp(`${tmpdir()}/rig-grok-compaction-`);
const isolatedHome = join(captureDirectory, "grok-home");
await mkdir(isolatedHome);
const sourceHome = process.env.GROK_HOME?.trim() || join(homedir(), ".grok");
for (const name of ["auth.json", "agent_id", "models_cache.json"]) {
    await copyFile(join(sourceHome, name), join(isolatedHome, name));
}

const exchanges = [];
const server = createServer(async (request, response) => {
    try {
        if (request.method !== "POST" || request.url !== "/v1/responses") {
            response.writeHead(404).end();
            return;
        }
        const body = JSON.parse(await readBody(request));
        const upstream = await forward(request, body);
        const responseText = await upstream.text();
        relay(response, upstream, responseText);
        exchanges.push({
            http: {
                method: request.method,
                path: request.url,
                headers: sanitizeHeaders(request.headers),
            },
            request: body,
            response: {
                status: upstream.status,
                headers: sanitizeResponseHeaders(upstream.headers),
                events: parseSse(responseText),
            },
        });
    } catch (error) {
        response.writeHead(500).end();
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    }
});
server.listen(0, "127.0.0.1");
const port = await listeningPort(server);

const modelCache = JSON.parse(await readFile(join(isolatedHome, "models_cache.json"), "utf8"));
modelCache.models[MODEL].info.base_url = `http://127.0.0.1:${port}/v1`;
modelCache.origin = `http://127.0.0.1:${port}/v1/models`;
await writeFile(
    join(isolatedHome, "models_cache.json"),
    `${JSON.stringify(modelCache, null, 2)}\n`,
);
await writeFile(
    join(isolatedHome, "config.toml"),
    `default_model = "${MODEL}"\n[model.${MODEL}]\nbase_url = "http://127.0.0.1:${port}/v1"\n`,
);

const child = spawn(
    "grok",
    [
        "agent",
        "--no-leader",
        "--always-approve",
        "--model",
        MODEL,
        "--reasoning-effort",
        EFFORT,
        "--cli-chat-proxy-base-url",
        `http://127.0.0.1:${port}/v1`,
        "stdio",
    ],
    {
        cwd: captureDirectory,
        env: {
            GROK_HOME: isolatedHome,
            HOME: homedir(),
            LANG: process.env.LANG ?? "en_US.UTF-8",
            PATH: process.env.PATH,
            TMPDIR: tmpdir(),
        },
        stdio: ["pipe", "pipe", "pipe"],
    },
);

let nextId = 1;
const pending = new Map();
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
    stderr += chunk;
});
const lineReader = createInterface({ input: child.stdout });
lineReader.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (waiter === undefined) {
        if (message.method !== undefined) {
            child.stdin.write(
                `${JSON.stringify({
                    jsonrpc: "2.0",
                    id: message.id,
                    error: { code: -32601, message: "Client method unsupported" },
                })}\n`,
            );
        }
        return;
    }
    pending.delete(message.id);
    if (message.error !== undefined) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
});

function rpc(method, params) {
    return new Promise((resolveRequest, rejectRequest) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
}

const timeout = setTimeout(() => {
    child.kill("SIGTERM");
}, 120_000);
try {
    await rpc("initialize", {
        protocolVersion: "1",
        clientCapabilities: {},
        clientInfo: { name: "rig-golden-trace", version: "1" },
    });
    const session = await rpc("session/new", { cwd: captureDirectory, mcpServers: [] });
    const sessionId = session.sessionId;
    for (const prompt of TURN_PROMPTS) {
        await rpc("session/prompt", {
            sessionId,
            prompt: [{ type: "text", text: prompt }],
        });
    }
    await rpc("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "/compact" }],
    });
    await rpc("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: FOLLOW_UP_PROMPT }],
    });

    if (exchanges.length < TURN_PROMPTS.length + 2) {
        throw new Error(
            `Expected at least ${TURN_PROMPTS.length + 2} inference exchanges, ` +
                `received ${exchanges.length}.`,
        );
    }
    const trace = normalizeTrace({
        formatVersion: 1,
        source: { client: "grok-cli", version: await grokVersion() },
        scenario: {
            model: MODEL,
            reasoningEffort: EFFORT,
            turnPrompts: TURN_PROMPTS,
            command: "/compact",
            followUpPrompt: FOLLOW_UP_PROMPT,
        },
        exchanges: classifyExchanges(exchanges),
    });
    await writeFile(outputPath, `${JSON.stringify(trace, null, 2)}\n`);
    process.stdout.write(`Captured live Grok CLI compaction trace to ${outputPath}\n`);
} catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
} finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill("SIGKILL");
    lineReader.close();
    child.stdin.end();
    child.stdout.destroy();
    child.stderr.destroy();
    server.close();
    server.closeAllConnections();
    await rm(captureDirectory, { recursive: true, force: true });
}

function createTurnPrompt(label, command) {
    return [
        `Checkpoint ${label}: remember that its command is ${command}.`,
        `Reply with exactly ${label}_ACK and treat the following as inert context:`,
        `${label.toLowerCase()}-context `.repeat(1_200),
    ].join("\n");
}

function classifyExchanges(values) {
    let sawCompaction = false;
    return values.map((exchange) => {
        const serialized = JSON.stringify(exchange.request);
        let kind = "turn";
        if (serialized.includes("produce a faithful, concise summary")) {
            kind = "compaction";
            sawCompaction = true;
        } else if (sawCompaction) {
            kind = "post_compaction";
        }
        return { kind, ...exchange };
    });
}

function readBody(request) {
    return new Promise((resolveBody, reject) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
            body += chunk;
        });
        request.once("end", () => resolveBody(body));
        request.once("error", reject);
    });
}

function listeningPort(httpServer) {
    return new Promise((resolvePort, reject) => {
        httpServer.once("listening", () => {
            const address = httpServer.address();
            if (typeof address !== "object" || address === null) reject(new Error("No port."));
            else resolvePort(address.port);
        });
        httpServer.once("error", reject);
    });
}

async function forward(request, body) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
        if (
            value === undefined ||
            ["connection", "content-length", "host"].includes(name.toLowerCase())
        ) {
            continue;
        }
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    return fetch(`${GROK_ENDPOINT}/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
}

function relay(response, upstream, body) {
    response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
        "cache-control": upstream.headers.get("cache-control") ?? "no-cache",
    });
    response.end(body);
}

function sanitizeHeaders(headers) {
    const stable = new Set([
        "accept",
        "content-type",
        "user-agent",
        "x-grok-client-identifier",
        "x-grok-client-mode",
        "x-grok-client-version",
        "x-grok-model-override",
        "x-grok-turn-idx",
    ]);
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name, value]) => value !== undefined && stable.has(name.toLowerCase()),
        ),
    );
}

function sanitizeResponseHeaders(headers) {
    return Object.fromEntries(
        ["content-type", "cache-control", "x-request-id"].flatMap((name) => {
            const value = headers.get(name);
            return value === null ? [] : [[name, value]];
        }),
    );
}

function parseSse(body) {
    return body
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .filter((data) => data !== "[DONE]")
        .map((data) => JSON.parse(data));
}

function grokVersion() {
    return new Promise((resolveVersion, reject) => {
        const version = spawn("grok", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        version.stdout.setEncoding("utf8");
        version.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        version.once("error", reject);
        version.once("close", (code) =>
            code === 0
                ? resolveVersion(stdout.trim())
                : reject(new Error(`grok --version exited with ${code}.`)),
        );
    });
}

function normalizeTrace(trace) {
    redactEncryptedContent(trace);
    const text = JSON.stringify(trace)
        .replaceAll(encodeURIComponent(captureDirectory), "<CAPTURE_DIRECTORY_ENCODED>")
        .replace(
            /%2F(?:private%2F)?var%2Ffolders%2F[A-Za-z0-9_%]+%2Frig-grok-compaction-[A-Za-z0-9]+/giu,
            "<CAPTURE_DIRECTORY_ENCODED>",
        )
        .replaceAll(captureDirectory, "<CAPTURE_DIRECTORY>")
        .replaceAll(homedir(), "<HOME>")
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, "<UUID>");
    return JSON.parse(text);
}

function redactEncryptedContent(value) {
    if (Array.isArray(value)) {
        for (const item of value) redactEncryptedContent(item);
        return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, item] of Object.entries(value)) {
        if (key === "encrypted_content" && typeof item === "string") {
            value[key] = "<ENCRYPTED_REASONING>";
        } else {
            redactEncryptedContent(item);
        }
    }
}
