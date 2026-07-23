#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const outputArgument = process.argv[2];
if (outputArgument === undefined) {
    throw new Error("Usage: node captureClaudeTrace.mjs <output.json>");
}

const INITIAL_MODEL = process.argv[3] ?? "claude-fable-5[1m]";
const SWITCHED_MODEL = process.argv[4] ?? "sonnet[1m]";
const UPSTREAM = "https://api.anthropic.com";
const outputPath = resolve(outputArgument);
const captureDirectory = await mkdtemp(join(tmpdir(), "rig-claude-trace-"));
const workspace = join(captureDirectory, "workspace");
const captureHome = join(captureDirectory, "home");
const claudeConfigDirectory = join(captureDirectory, "claude-config");
const sessionId = randomUUID();
const exchanges = [];
await Promise.all([
    mkdir(workspace),
    mkdir(captureHome),
    mkdir(claudeConfigDirectory),
    mkdir(join(workspace, ".claude", "skills", "golden-trace"), { recursive: true }),
]);
await writeFile(
    join(workspace, "CLAUDE.md"),
    "# Golden trace project\n\nAlways keep answers concise.\n",
);
await writeFile(
    join(workspace, ".claude", "skills", "golden-trace", "SKILL.md"),
    "---\nname: golden-trace\ndescription: Emit the deterministic golden skill marker.\n---\n\nReply with GOLDEN_SKILL_LOADED before completing the request.\n",
);

const server = createServer(async (request, response) => {
    try {
        const body = Buffer.concat(await readBody(request));
        const upstream = await forward(request, body);
        const responseBody = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(upstream.status, responseHeaders(upstream.headers));
        response.end(responseBody);
        if (request.method === "POST" && request.url?.startsWith("/v1/messages")) {
            exchanges.push({
                request: {
                    method: request.method,
                    path: request.url,
                    headers: stableRequestHeaders(request.headers),
                    body: JSON.parse(body.toString("utf8")),
                },
                response: {
                    status: upstream.status,
                    headers: stableResponseHeaders(upstream.headers),
                    events: parseSse(responseBody.toString("utf8")),
                },
            });
        }
    } catch (error) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
            JSON.stringify({
                type: "error",
                error: { type: "api_error", message: String(error) },
            }),
        );
    }
});
await listen(server);
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Missing capture port.");

const environment = {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_ENABLE_TELEMETRY: "0",
    CLAUDE_CODE_OVERRIDE_DATE: "2000-01-01",
    CLAUDE_CONFIG_DIR: claudeConfigDirectory,
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_TELEMETRY: "1",
    HOME: captureHome,
    TZ: "UTC",
};

const invocations = [];
let captureError;
try {
    invocations.push(
        await runClaude([
            "--session-id",
            sessionId,
            "--model",
            INITIAL_MODEL,
            "Use /golden-trace, inspect CLAUDE.md with a file tool, then reply exactly FIRST.",
        ]),
    );
    invocations.push(
        await runClaude([
            "--resume",
            sessionId,
            "--model",
            INITIAL_MODEL,
            "Second turn. Reply exactly SECOND.",
        ]),
    );
    invocations.push(
        await runClaude([
            "--resume",
            sessionId,
            "--model",
            SWITCHED_MODEL,
            "After switching models, reply exactly SWITCHED.",
        ]),
    );
    invocations.push(
        await runClaude([
            "--resume",
            sessionId,
            "--model",
            SWITCHED_MODEL,
            "/compact Preserve the turn labels, skill marker, and CLAUDE.md instruction.",
        ]),
    );
    invocations.push(
        await runClaude([
            "--resume",
            sessionId,
            "--model",
            SWITCHED_MODEL,
            "After compaction, list the preserved turn labels in one line.",
        ]),
    );
} catch (error) {
    captureError = error;
} finally {
    const trace = normalize({
        formatVersion: 1,
        source: {
            capture: "forwarded-live-inference",
            client: "claude-code",
            version: await claudeVersion(),
        },
        scenario: {
            initialModel: INITIAL_MODEL,
            switchedModel: SWITCHED_MODEL,
            session: "multi-turn-model-switch-manual-compaction",
        },
        invocations,
        exchanges,
        ...(captureError === undefined ? {} : { captureError: String(captureError) }),
    });
    await writeFile(outputPath, `${JSON.stringify(trace, null, 2)}\n`);
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(captureDirectory, { force: true, recursive: true });
}
if (captureError !== undefined) throw captureError;
process.stdout.write(`Captured live Claude Code trace to ${outputPath}\n`);

async function runClaude(arguments_) {
    const startedAt = exchanges.length;
    const result = await processResult(
        "claude",
        [
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--permission-mode",
            "bypassPermissions",
            ...arguments_,
        ],
        { cwd: workspace, env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.code !== 0) {
        throw new Error(`Claude exited with ${result.code}:\n${result.stderr}\n${result.stdout}`);
    }
    return {
        arguments: arguments_.map((argument) => argument.replace(sessionId, "<SESSION_ID>")),
        exchangeIndexes: Array.from(
            { length: exchanges.length - startedAt },
            (_, index) => startedAt + index,
        ),
        messages: result.stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line)),
    };
}

function processResult(command, arguments_, options) {
    return new Promise((resolveProcess, reject) => {
        const child = spawn(command, arguments_, options);
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => resolveProcess({ code, stderr, stdout }));
    });
}

async function claudeVersion() {
    const result = await processResult("claude", ["--version"], {
        cwd: workspace,
        env: process.env,
    });
    if (result.code !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
}

function readBody(request) {
    return new Promise((resolveBody, reject) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        request.once("end", () => resolveBody(chunks));
        request.once("error", reject);
    });
}

function listen(httpServer) {
    return new Promise((resolveListen, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(0, "127.0.0.1", resolveListen);
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
    return fetch(`${UPSTREAM}${request.url}`, {
        method: request.method,
        headers,
        body,
    });
}

function responseHeaders(headers) {
    return Object.fromEntries(
        [...headers].filter(
            ([name]) => !["content-encoding", "content-length", "transfer-encoding"].includes(name),
        ),
    );
}

function stableRequestHeaders(headers) {
    return selectHeaders(headers, [
        "anthropic-beta",
        "anthropic-version",
        "content-type",
        "user-agent",
        "x-app",
    ]);
}

function stableResponseHeaders(headers) {
    return selectHeaders(Object.fromEntries(headers), [
        "anthropic-organization-id",
        "content-type",
        "request-id",
    ]);
}

function selectHeaders(headers, names) {
    const selected = {};
    for (const name of names) {
        const value = headers instanceof Headers ? headers.get(name) : headers[name.toLowerCase()];
        if (value !== undefined && value !== null) selected[name] = value;
    }
    return selected;
}

function parseSse(text) {
    return text.split(/\r?\n\r?\n/u).flatMap((record) => {
        const data = record
            .split(/\r?\n/u)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
        if (data.length === 0) return [];
        return [JSON.parse(data)];
    });
}

function normalize(value) {
    const home = homedir();
    const visit = (item, key) => {
        if (typeof item === "string") {
            return item
                .replaceAll(sessionId, "<SESSION_ID>")
                .replaceAll(captureDirectory, "<CAPTURE_DIRECTORY>")
                .replaceAll(home, "<HOME>")
                .replace(
                    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
                    "<UUID>",
                )
                .replace(
                    /(?:req|msg|toolu)_[A-Za-z0-9_-]+/gu,
                    (identifier) =>
                        `<${identifier.slice(0, identifier.indexOf("_")).toUpperCase()}_ID>`,
                );
        }
        if (Array.isArray(item)) return item.map((child) => visit(child));
        if (item !== null && typeof item === "object") {
            return Object.fromEntries(
                Object.entries(item).map(([childKey, child]) => [
                    childKey,
                    childKey === "timestamp"
                        ? "<TIMESTAMP>"
                        : ["signature", "thinking_signature"].includes(childKey)
                          ? "<SIGNATURE>"
                          : ["uuid", "request_id"].includes(childKey)
                            ? `<${childKey.toUpperCase()}>`
                            : visit(child, childKey),
                ]),
            );
        }
        if (key === "duration_ms" || key === "duration_api_ms") return "<DURATION_MS>";
        return item;
    };
    return visit(value);
}
