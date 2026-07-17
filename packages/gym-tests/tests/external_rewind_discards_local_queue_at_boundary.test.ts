import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("external rewind boundary", () => {
    it("cancels local queued startup, saves it to history, and accepts only fresh work", async () => {
        const initial = "Prepare a queued-turn rewind gate.";
        const queued = "Do not run this queued pre-rewind prompt.";
        const fresh = "Run only this fresh post-rewind prompt.";
        const finishInitialTurn = deferred<void>();
        const continuationStarted = deferred<void>();
        const createBlockingSkills = [
            "node -e '",
            'const fs=require("fs"); for(let i=0;i<2000;i++){',
            'const dir="/home/rig/.agents/skills/rewind-gate-"+i;',
            "fs.mkdirSync(dir,{recursive:true});",
            'fs.writeFileSync(dir+"/SKILL.md","---\\nname: rewind-gate-"+i+"\\ndescription: Gym rewind gate\\n---\\ngate\\n");',
            "}'",
        ].join(" ");
        const gym = await createGym({
            cols: 82,
            inference: async (request, callIndex) => {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: createBlockingSkills },
                                id: "create-rewind-skill-gate",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    continuationStarted.resolve();
                    await finishInitialTurn.promise;
                    return { content: [{ text: "INITIAL_TURN_COMPLETE", type: "text" }] };
                }
                expect(callIndex).toBe(2);
                const userTexts = request.context.messages.flatMap((message) =>
                    message.role === "user" ? [messageText(message.content)] : [],
                );
                expect(userTexts).toEqual([fresh]);
                return { content: [{ text: "FRESH_POST_REWIND_RESPONSE", type: "text" }] };
            },
            rows: 30,
        });
        running.add(gym);

        submit(gym, initial);
        await continuationStarted.promise;
        gym.terminal.type(queued);
        await waitForComposer(gym, queued);
        gym.terminal.press("tab");
        await gym.terminal.waitForText(`↳ queued ${queued}`, 30_000);

        finishInitialTurn.resolve();
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("INITIAL_TURN_COMPLETE") &&
                snapshot.text.includes("esc to interrupt"),
            "the local queued turn entering startup after daemon settlement",
            30_000,
        );

        const rewind = await gym.runInContainer("node", ["-e", rewindSessionScript, initial]);
        expect(rewind.stderr).toBe("");
        expect(rewind.stdout).toContain("rewound\n");

        const boundary = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes(
                    "Conversation rewound. Queued input was saved to input history.",
                ) &&
                !snapshot.text.includes("esc to interrupt") &&
                !snapshot.text.includes("↳ queued"),
            "external rewind to cancel local queued startup",
            30_000,
        );
        expect(boundary.text).not.toContain("Do not run this queued pre-rewind prompt.\n\n•");
        expect(agentRequests(gym)).toHaveLength(2);

        gym.terminal.press("up");
        await waitForComposer(gym, queued);
        gym.terminal.press("ctrlC");
        submit(gym, fresh);
        await gym.terminal.waitForText("FRESH_POST_REWIND_RESPONSE", 30_000);
        expect(agentRequests(gym)).toHaveLength(3);
        await screenshot(gym, "external-rewind-local-queue-boundary.png");
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    );
}

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter(
            (block): block is { text: string } =>
                typeof block === "object" &&
                block !== null &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("");
}

async function waitForComposer(gym: Gym, text: string) {
    return gym.terminal.waitUntil(
        (snapshot) => composerText(snapshot) === text,
        `composer text ${JSON.stringify(text)}`,
        30_000,
    );
}

function composerText(snapshot: { rows: readonly string[] }): string | undefined {
    const footer = snapshot.rows.findIndex((row) => row.includes("gym off · /workspace"));
    const row = footer >= 2 ? snapshot.rows[footer - 2] : undefined;
    return row?.replace(/^\s*›\s?/u, "").trimEnd();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolvePromiseValue) => {
        resolvePromise = resolvePromiseValue;
    });
    return { promise, resolve: (value) => resolvePromise(value as T) };
}

async function screenshot(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}

const rewindSessionScript = String.raw`
const { readFile } = require("node:fs/promises");
const { request } = require("node:http");

(async () => {
    const directory = "/tmp/rig-" + process.getuid();
    const socketPath = directory + "/server.sock";
    const token = (await readFile(directory + "/token", "utf8")).trim();
    const requestJson = (method, path, body) => new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
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
                if ((response.statusCode ?? 500) >= 400) reject(new Error(text));
                else resolve(text.length === 0 ? {} : JSON.parse(text));
            });
        });
        outgoing.on("error", reject);
        if (payload !== undefined) outgoing.write(payload);
        outgoing.end();
    });
    const sessions = await requestJson("GET", "/sessions");
    const session = sessions.sessions[0];
    if (session === undefined) throw new Error("No primary session found.");
    const history = await requestJson(
        "GET",
        "/sessions/" + encodeURIComponent(session.id) + "/events",
    );
    const submitted = history.events.find(
        (event) => event.type === "message_submitted" && event.data.displayText === process.argv[1],
    );
    if (submitted === undefined) throw new Error("The rewind target was not found.");
    await requestJson(
        "POST",
        "/sessions/" + encodeURIComponent(session.id) + "/rewind",
        { messageId: submitted.data.message.id },
    );
    process.stdout.write("rewound\n");
})().catch((error) => {
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
});
`;
