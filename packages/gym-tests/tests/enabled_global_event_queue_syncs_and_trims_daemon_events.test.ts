import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("enabled global event queue syncs and trims daemon events", () => {
    it("lets an external process acknowledge global changes without removing session history", async () => {
        const gym = await createGym({
            files: {
                "inspect-global-events.mjs": inspectGlobalEventsScript,
            },
            inference: [
                {
                    content: [
                        {
                            arguments: { cmd: "node inspect-global-events.mjs enable" },
                            id: "enable-global-events",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [
                        {
                            arguments: { cmd: "node inspect-global-events.mjs sync" },
                            id: "sync-global-events",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "The durable queue was synchronized.", type: "text" }] },
            ],
        });
        running.add(gym);

        gym.terminal.type("Synchronize the daemon event queue with the test backend.");
        gym.terminal.press("enter");

        const screen = await gym.terminal.waitForText(
            "The durable queue was synchronized.",
            30_000,
        );
        expect(screen.text).toContain("The durable queue was synchronized.");

        const result = JSON.parse(await gym.readFile("global-event-sync-result.json")) as {
            queuedTypes: string[];
            remainingCursors: number[];
            sessionHistoryTypes: string[];
            trim: { through: number; trimmed: number };
        };
        expect(result.queuedTypes).toContain("session_created");
        expect(result.queuedTypes).toContain("agent_message");
        expect(result.queuedTypes).not.toContain("agent_event");
        expect(result.trim.trimmed).toBe(1);
        expect(result.remainingCursors.every((cursor) => cursor > result.trim.through)).toBe(true);
        expect(result.sessionHistoryTypes).toContain("session_created");
        const enabled = JSON.parse(await gym.readFile("global-event-enable-result.json")) as {
            after: boolean;
            before: boolean;
        };
        expect(enabled).toEqual({ after: true, before: false });
    }, 120_000);
});

const inspectGlobalEventsScript = String.raw`
import { readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";

const directory = "/tmp/rig-" + process.getuid();
const socketPath = directory + "/server.sock";
const token = (await readFile(directory + "/token", "utf8")).trim();

function requestJson(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const requestOptions = {
            socketPath,
            path,
            method,
            headers: {
                authorization: "Bearer " + token,
                accept: "application/json",
                ...(payload === undefined
                    ? {}
                    : {
                          "content-type": "application/json",
                          "content-length": Buffer.byteLength(payload),
                      }),
            },
        };
        const outgoing = request(requestOptions, (response) => {
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
        outgoing.on("error", reject);
        if (payload !== undefined) outgoing.write(payload);
        outgoing.end();
    });
}

if (process.argv[2] === "enable") {
    const before = await requestJson("GET", "/config");
    const updated = await requestJson("PATCH", "/config", {
        settings: { durableGlobalEventQueue: true },
    });
    await requestJson("POST", "/sessions", { cwd: "/workspace" });
    await writeFile(
        "global-event-enable-result.json",
        JSON.stringify({
            before: before.config.settings.durableGlobalEventQueue,
            after: updated.config.settings.durableGlobalEventQueue,
        }),
    );
} else {
    const queued = await requestJson("GET", "/events?limit=100");
    if (queued.events.length === 0) throw new Error("The global event queue is empty.");
    const first = queued.events[0];
    const trim = await requestJson("POST", "/events/trim", { through: first.cursor });
    const remaining = await requestJson("GET", "/events?after=" + first.cursor + "&limit=100");
    const sessionId = first.event.sessionId;
    const history = await requestJson("GET", "/sessions/" + encodeURIComponent(sessionId) + "/events");

    await writeFile(
        "global-event-sync-result.json",
        JSON.stringify({
            queuedTypes: queued.events.map((entry) => entry.event.type),
            remainingCursors: remaining.events.map((entry) => entry.cursor),
            sessionHistoryTypes: history.events.map((event) => event.type),
            trim,
        }),
    );
}
`;
