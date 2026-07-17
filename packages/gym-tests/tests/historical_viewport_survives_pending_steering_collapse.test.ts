import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { captureScrollback, createGym, waitForTerminalOutput, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("pending local and external steering while reading history", () => {
    it("keeps an exact anchor through live-tail display, repeated navigation, and consumption", async () => {
        const releaseToolBoundary = deferred<void>();
        const releaseExternalQueue = deferred<void>();
        const localSteering = "Preserve the local steering instruction.";
        const externalSteering = "Preserve the external steering instruction.";
        const localQueue = "Run the locally queued follow-up.";
        const externalQueue = "Run the externally queued follow-up.";
        const history = [
            "STEERING_HISTORY_BEGIN",
            ...Array.from(
                { length: 110 },
                (_, index) => `STEERING_HISTORY_${String(index).padStart(3, "0")} stable row`,
            ),
            "STEERING_HISTORY_END",
        ].join("\n");
        const gym = await createGym({
            cols: 76,
            files: { "steer-from-another-client.mjs": steerFromAnotherClientScript },
            inference: async (request, callIndex) => {
                if (callIndex === 0) return { content: [{ text: history, type: "text" }] };
                if (callIndex === 1) {
                    await releaseToolBoundary.promise;
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "printf 'STEERING_BOUNDARY_%s\\n' TOOL_RAN",
                                },
                                id: "anchored-steering-boundary-tool",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                const userText = request.context.messages
                    .filter((message) => message.role === "user")
                    .map((message) => JSON.stringify(message.content))
                    .join("\n");
                if (callIndex === 2) {
                    expect(userText).toContain(localQueue);
                    expect(userText).toContain(localSteering);
                    expect(userText).toContain(externalSteering);
                    return { content: [{ text: "STEERING_COLLAPSE_COMPLETE", type: "text" }] };
                }

                expect(callIndex).toBe(3);
                expect(userText).toContain(externalQueue);
                await releaseExternalQueue.promise;
                return { content: [{ text: "EXTERNAL_QUEUE_COMPLETE", type: "text" }] };
            },
            rows: 16,
        });
        running.add(gym);

        submit(gym, "Create steering history.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("STEERING_HISTORY_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "steering history at the bottom",
            30_000,
        );

        submit(gym, "Wait for local and external steering before running a tool.");
        await gym.terminal.waitForText("esc to interrupt", 30_000);
        gym.terminal.scrollToTop();
        gym.terminal.scrollBy(48);
        const anchored = await gym.terminal.snapshot();
        expect(anchored.scroll.atTop).toBe(false);
        expect(anchored.scroll.atBottom).toBe(false);
        expect(anchored.text).toContain("STEERING_HISTORY_");
        const anchorMarker = /STEERING_HISTORY_\d{3}/u.exec(anchored.text)?.[0];
        expect(anchorMarker).toBeDefined();
        if (anchorMarker === undefined) throw new Error("Steering anchor marker was not visible.");
        const output: string[] = [];
        const stopOutputCapture = gym.terminal.onOutput((data) => output.push(data));
        await screenshot(gym, "steering-01-anchored.png");

        gym.terminal.type(localQueue);
        const localQueueOutput = waitForTerminalOutput(gym, localQueue, 30_000);
        gym.terminal.press("tab");
        await localQueueOutput;

        const externalQueueOutput = waitForTerminalOutput(gym, externalQueue, 30_000);
        const queuedExternally = await gym.runInContainer("node", [
            "/workspace/steer-from-another-client.mjs",
            "messages",
            externalQueue,
        ]);
        expect(queuedExternally.stderr).toBe("");
        expect(queuedExternally.stdout.trim()).toBe("submitted");
        await externalQueueOutput;

        submit(gym, localSteering);
        const externalOutput = waitForTerminalOutput(gym, externalSteering, 30_000);
        const external = await gym.runInContainer("node", [
            "/workspace/steer-from-another-client.mjs",
            "steer",
            externalSteering,
        ]);
        expect(external.stderr).toBe("");
        expect(external.stdout.trim()).toBe("steered");
        await externalOutput;

        const pendingWhileAnchored = await gym.terminal.snapshot();
        assertSameViewport(pendingWhileAnchored, anchored);
        await screenshot(gym, "steering-02-pending-while-anchored.png");

        gym.terminal.scrollToBottom();
        const pendingBottom = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Messages to be submitted after next tool call") &&
                snapshot.text.includes("Preserve the local steering") &&
                snapshot.text.includes("Preserve the external steering") &&
                snapshot.text.includes(localQueue) &&
                snapshot.text.includes(`› ${externalQueue}`) &&
                snapshot.text.includes("esc to interrupt") &&
                snapshot.scroll.atBottom,
            "the current pending steering live tail",
            30_000,
        );
        expect(pendingBottom.text).not.toContain(`› ${localSteering}`);

        gym.terminal.scrollToTop();
        gym.terminal.scrollBy(48);
        const anchoredAgain = await gym.terminal.snapshot();
        assertSameViewport(anchoredAgain, anchored, 1);

        const completionOutput = waitForTerminalOutput(gym, "STEERING_COLLAPSE_COMPLETE", 30_000);
        releaseToolBoundary.resolve();
        await completionOutput;
        const externalQueueWaiting = await gym.terminal.waitUntil(
            () => agentRequestCount(gym) === 4,
            "the external queued turn to reach its inference gate",
            30_000,
        );
        assertSameViewport(externalQueueWaiting, anchoredAgain);

        const externalQueueOutputComplete = waitForTerminalOutput(
            gym,
            "EXTERNAL_QUEUE_COMPLETE",
            30_000,
        );
        releaseExternalQueue.resolve();
        await externalQueueOutputComplete;
        const consumedWhileAnchored = await gym.terminal.snapshot();
        assertSameViewport(consumedWhileAnchored, anchoredAgain);
        expect(output.join("")).not.toContain("\x1b[3J");
        expect(output.join("")).not.toContain("\x1b[2J\x1b[H");
        stopOutputCapture();
        await screenshot(gym, "steering-03-consumed-while-anchored.png");

        gym.terminal.scrollToBottom();
        const completeBottom = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("STEERING_COLLAPSE_COMPLETE") &&
                snapshot.text.includes("EXTERNAL_QUEUE_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the settled steering transcript tail",
            30_000,
        );
        expect(completeBottom.text).not.toContain("Messages to be submitted after next tool call");

        const scrollback = await captureScrollback(gym);
        expect(countOccurrences(scrollback, anchorMarker)).toBe(1);
        expect(countOccurrences(scrollback, "Preserve the local steering")).toBe(1);
        expect(countOccurrences(scrollback, "Preserve the external steering")).toBe(1);
        expect(countOccurrences(scrollback, localQueue)).toBe(1);
        expect(countOccurrences(scrollback, externalQueue)).toBe(1);
        expect(countOccurrences(scrollback, "STEERING_BOUNDARY_TOOL_RAN")).toBe(1);
        expect(countOccurrences(scrollback, "STEERING_COLLAPSE_COMPLETE")).toBe(1);
        expect(countOccurrences(scrollback, "EXTERNAL_QUEUE_COMPLETE")).toBe(1);
        expect(maximumBlankRun(scrollback)).toBeLessThanOrEqual(4);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function assertSameViewport(
    actual: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    expected: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    transitionDelta = 0,
): void {
    expect(actual.rows).toEqual(expected.rows);
    expect(actual.text).toBe(expected.text);
    expect(actual.scroll.offset).toBe(expected.scroll.offset);
    expect(actual.scroll.bottomDepartureCount).toBe(
        expected.scroll.bottomDepartureCount + transitionDelta,
    );
    expect(actual.scroll.topArrivalCount).toBe(expected.scroll.topArrivalCount + transitionDelta);
}

function agentRequestCount(gym: Gym): number {
    return gym.inference.requests.filter(
        (request) => request.options.sessionId?.endsWith(":title") !== true,
    ).length;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolvePromiseValue) => {
        resolvePromise = resolvePromiseValue;
    });
    return { promise, resolve: (value) => resolvePromise(value as T) };
}

async function screenshot(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}

function countOccurrences(value: string, search: string): number {
    return value.split(search).length - 1;
}

function maximumBlankRun(value: string): number {
    let maximum = 0;
    let current = 0;
    for (const row of value.split("\n")) {
        current = row.trim().length === 0 ? current + 1 : 0;
        maximum = Math.max(maximum, current);
    }
    return maximum;
}

const steerFromAnotherClientScript = String.raw`
import { readFile } from "node:fs/promises";
import { request } from "node:http";

const directory = "/tmp/rig-" + process.getuid();
const socketPath = directory + "/server.sock";
const token = (await readFile(directory + "/token", "utf8")).trim();

function requestJson(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const outgoing = request({
            socketPath,
            path,
            method,
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
        outgoing.on("error", reject);
        if (payload !== undefined) outgoing.write(payload);
        outgoing.end();
    });
}

const sessions = await requestJson("GET", "/sessions");
const active = sessions.sessions.find((session) => session.status === "running");
if (active === undefined) throw new Error("No running session found.");
const mode = process.argv[2];
if (mode !== "steer" && mode !== "messages") throw new Error("Unknown submission mode.");
await requestJson(
    "POST",
    "/sessions/" + encodeURIComponent(active.id) + "/" + mode,
    { text: process.argv[3] },
);
process.stdout.write(mode === "steer" ? "steered\n" : "submitted\n");
`;
