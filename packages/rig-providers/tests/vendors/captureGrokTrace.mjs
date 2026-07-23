#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MODEL = "grok-4.5";
const GROK_ENDPOINT = "https://cli-chat-proxy.grok.com/v1";
const EFFORT = process.argv[3] ?? "low";
const PROMPT = "Reply with OK.";
const outputArgument = process.argv[2];
if (outputArgument === undefined)
    throw new Error("Usage: node captureGrokTrace.mjs <output.json> [low|medium|high]");
if (!["low", "medium", "high"].includes(EFFORT)) {
    throw new Error(`Unsupported reasoning effort '${EFFORT}'.`);
}

const outputPath = resolve(outputArgument);
const captureDirectory = await mkdtemp(`${tmpdir()}/rig-grok-capture-`);
const isolatedHome = join(captureDirectory, "grok-home");
await mkdir(isolatedHome);
const sourceHome = process.env.GROK_HOME?.trim() || join(homedir(), ".grok");
for (const name of ["auth.json", "agent_id", "models_cache.json"]) {
    await copyFile(join(sourceHome, name), join(isolatedHome, name));
}
await writeFile(
    join(isolatedHome, "config.toml"),
    `default_model = "${MODEL}"\n[model.${MODEL}]\nbase_url = "http://127.0.0.1:0/v1"\n`,
);

let resolveCapture;
let rejectCapture;
const capture = new Promise((resolvePromise, rejectPromise) => {
    resolveCapture = resolvePromise;
    rejectCapture = rejectPromise;
});
let port;
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
        if (request.headers["x-grok-turn-idx"] === undefined) return;

        const trace = normalizeTrace({
            formatVersion: 1,
            source: { client: "grok-cli", version: await grokVersion() },
            invocation: { model: MODEL, reasoningEffort: EFFORT, prompt: PROMPT },
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
        await writeFile(outputPath, `${JSON.stringify(trace, null, 2)}\n`);
        resolveCapture();
    } catch (error) {
        rejectCapture(error);
        response.writeHead(500).end();
    }
});
server.on("error", rejectCapture);
server.listen(0, "127.0.0.1");
port = await listeningPort(server);

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
        "--single",
        PROMPT,
        "--verbatim",
        "--model",
        MODEL,
        "--reasoning-effort",
        EFFORT,
        "--no-memory",
        "--no-plan",
        "--no-subagents",
        "--disable-web-search",
        "--always-approve",
        "--cwd",
        captureDirectory,
    ],
    {
        env: {
            GROK_HOME: isolatedHome,
            GROK_CLI_CHAT_PROXY_BASE_URL: `http://127.0.0.1:${port}/v1`,
            HOME: homedir(),
            LANG: process.env.LANG ?? "en_US.UTF-8",
            PATH: process.env.PATH,
            TMPDIR: tmpdir(),
        },
        stdio: ["ignore", "ignore", "pipe"],
    },
);
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
    stderr += chunk;
});
child.on("error", rejectCapture);
const timeout = setTimeout(
    () => rejectCapture(new Error("Grok did not send a request within 30 seconds.")),
    30_000,
);
try {
    await capture;
    process.stdout.write(`Captured ${MODEL} ${EFFORT} request to ${outputPath}\n`);
} catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
} finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill("SIGTERM");
    server.close();
    await rm(captureDirectory, { recursive: true, force: true });
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

function sanitizeHeaders(headers) {
    const stable = new Set([
        "accept",
        "content-type",
        "user-agent",
        "x-authenticateresponse",
        "x-grok-client-identifier",
        "x-grok-client-mode",
        "x-grok-client-version",
        "x-grok-model-override",
        "x-grok-turn-idx",
        "x-xai-token-auth",
    ]);
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name, value]) => value !== undefined && stable.has(name.toLowerCase()),
        ),
    );
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
    return fetch(`${GROK_ENDPOINT}${request.url.slice("/v1".length)}`, {
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

function normalizeTrace(trace) {
    redactEncryptedContent(trace);
    const text = JSON.stringify(trace)
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
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
        if (key === "encrypted_content" && typeof child === "string") {
            value[key] = "<ENCRYPTED_REASONING>";
        } else {
            redactEncryptedContent(child);
        }
    }
}
