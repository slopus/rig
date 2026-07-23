#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { gunzipSync, zstdDecompressSync } from "node:zlib";

const SUPPORTED_MODELS = new Set([
    "openai.gpt-5.6-sol",
    "openai.gpt-5.6-terra",
    "openai.gpt-5.6-luna",
]);
const REASONING_EFFORT = "low";
const PROMPT = "Reply with OK.";
const CAPTURE_TIMEOUT_MS = 30_000;
const PLACEHOLDER_TOKEN = "rig-bedrock-capture-token";

const outputArgument = process.argv[2];
const model = process.argv[3];
if (outputArgument === undefined || model === undefined) {
    throw new Error("Usage: node captureCodexBedrockTrace.mjs <output.json> <model>");
}
if (!SUPPORTED_MODELS.has(model)) throw new Error(`Unsupported capture model '${model}'.`);

const outputPath = resolve(outputArgument);
const captureDirectory = await mkdtemp(`${tmpdir()}/rig-codex-bedrock-capture-`);
let resolveCapture;
let rejectCapture;
const capture = new Promise((resolvePromise, rejectPromise) => {
    resolveCapture = resolvePromise;
    rejectCapture = rejectPromise;
});
const server = createServer(async (request, response) => {
    try {
        if (request.method !== "POST") {
            response.writeHead(404).end();
            return;
        }
        const requestBytes = await readBody(request);
        const trace = {
            formatVersion: 1,
            source: {
                client: "codex-cli",
                version: await codexVersion(),
                provider: "amazon-bedrock",
                transport: "sse",
                capture: "initial-request-only",
            },
            invocation: { model, reasoningEffort: REASONING_EFFORT, prompt: PROMPT },
            http: {
                method: request.method,
                path: request.url,
                headers: sanitizeHeaders(request.headers),
            },
            request: normalizeRequest(
                JSON.parse(decodeRequestBody(requestBytes, request.headers["content-encoding"])),
                captureDirectory,
            ),
        };
        await writeFile(outputPath, `${JSON.stringify(trace, null, 4)}\n`, "utf8");
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "capture complete" } }));
        resolveCapture();
    } catch (error) {
        rejectCapture(error);
        response.writeHead(500).end();
    }
});
server.on("error", rejectCapture);
server.listen(0, "127.0.0.1");
const port = await listeningPort(server);

const codex = spawn(
    "codex",
    [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--json",
        "--cd",
        captureDirectory,
        "--model",
        model,
        "--config",
        'model_provider="amazon-bedrock"',
        "--config",
        `model_reasoning_effort="${REASONING_EFFORT}"`,
        "--config",
        `model_providers.amazon-bedrock.base_url="http://127.0.0.1:${port}/openai/v1"`,
        PROMPT,
    ],
    {
        env: {
            AWS_BEARER_TOKEN_BEDROCK: PLACEHOLDER_TOKEN,
            AWS_REGION: "us-east-1",
            CODEX_HOME: captureDirectory,
            HOME: homedir(),
            LANG: process.env.LANG ?? "en_US.UTF-8",
            PATH: process.env.PATH,
            TMPDIR: tmpdir(),
        },
        stdio: ["ignore", "ignore", "pipe"],
    },
);
let stderr = "";
codex.stderr.setEncoding("utf8");
codex.stderr.on("data", (chunk) => {
    stderr += chunk;
});
codex.on("error", rejectCapture);
const timeout = setTimeout(
    () =>
        rejectCapture(
            new Error(`Codex did not send a Bedrock request within ${CAPTURE_TIMEOUT_MS}ms.`),
        ),
    CAPTURE_TIMEOUT_MS,
);

try {
    await capture;
    process.stdout.write(`Captured ${model} initial Bedrock request to ${outputPath}\n`);
} catch (error) {
    throw new Error(
        `${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`,
    );
} finally {
    clearTimeout(timeout);
    if (codex.exitCode === null) codex.kill("SIGTERM");
    server.close();
    await rm(captureDirectory, { force: true, recursive: true });
}

function readBody(request) {
    return new Promise((resolvePromise, rejectPromise) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.once("end", () => resolvePromise(Buffer.concat(chunks)));
        request.once("error", rejectPromise);
    });
}

function decodeRequestBody(bytes, encoding) {
    if (encoding === "zstd") return zstdDecompressSync(bytes).toString("utf8");
    if (encoding === "gzip") return gunzipSync(bytes).toString("utf8");
    if (encoding === undefined || encoding === "identity") return bytes.toString("utf8");
    throw new Error(`Unsupported Codex request content encoding '${encoding}'.`);
}

function listeningPort(httpServer) {
    return new Promise((resolvePromise, rejectPromise) => {
        httpServer.once("listening", () => {
            const address = httpServer.address();
            if (typeof address !== "object" || address === null) {
                rejectPromise(new Error("Bedrock capture server did not bind a TCP port."));
            } else resolvePromise(address.port);
        });
        httpServer.once("error", rejectPromise);
    });
}

async function codexVersion() {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("codex", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.once("error", rejectPromise);
        child.once("close", (code) =>
            code === 0
                ? resolvePromise(stdout.trim())
                : rejectPromise(new Error(`codex --version exited with ${code}.`)),
        );
    });
}

function sanitizeHeaders(headers) {
    const stableHeaders = new Set([
        "accept",
        "authorization",
        "content-type",
        "originator",
        "user-agent",
        "x-amzn-mantle-client-agent",
        "x-codex-beta-features",
    ]);
    return Object.fromEntries(
        Object.entries(headers)
            .filter(([name, value]) => value !== undefined && stableHeaders.has(name.toLowerCase()))
            .map(([name, value]) => [
                name,
                name.toLowerCase() === "authorization" ? "Bearer <BEDROCK_TOKEN>" : value,
            ]),
    );
}

function normalizeRequest(request, temporaryDirectory) {
    if ("prompt_cache_key" in request) request.prompt_cache_key = "<SESSION_ID>";
    if (request.client_metadata !== undefined) {
        request.client_metadata = Object.fromEntries(
            Object.keys(request.client_metadata).map((key) => [key, `<DYNAMIC:${key}>`]),
        );
    }
    for (const item of request.input ?? []) {
        if (item?.type !== "message" || !Array.isArray(item.content)) continue;
        for (const content of item.content) {
            if (content?.type !== "input_text" || content.text === PROMPT) continue;
            content.text = content.text
                .replaceAll(temporaryDirectory, "<CAPTURE_DIRECTORY>")
                .replaceAll(homedir(), "<HOME>")
                .replace(
                    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu,
                    "<UUID>",
                );
        }
    }
    return request;
}
