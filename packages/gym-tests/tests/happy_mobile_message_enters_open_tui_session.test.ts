import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";
import {
    decryptHappyPayload,
    encryptHappyPayload,
} from "../../rig/sources/happy/happyEncryption.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Happy mobile input", () => {
    it("publishes and applies Rig permission modes before mobile input enters the TUI", async () => {
        const secret = new Uint8Array(32).fill(7);
        const encryptedMobileMessage = Buffer.from(
            encryptHappyPayload(secret, "legacy", {
                content: { text: "Continue from Happy mobile.", type: "text" },
                meta: { permissionMode: "read_only", sentFrom: "ios" },
                role: "user",
            }),
        ).toString("base64");
        let publishedMetadata: unknown;
        let servedMobileMessage = false;
        const gym = await createGym({
            environment: {
                NO_PROXY: "127.0.0.1,localhost",
                RIG_HAPPY_SERVER_URL: "{{HTTP_PROXY_URL}}",
            },
            homeFiles: {
                ".happy/access.key": JSON.stringify({
                    secret: Buffer.from(secret).toString("base64"),
                    token: "happy-gym-token",
                }),
            },
            httpProxy: {
                handler(request) {
                    const url = new URL(request.url);
                    const json = (value: unknown) => ({
                        response: {
                            body: JSON.stringify(value),
                            headers: { "content-type": "application/json" },
                            status: 200,
                        },
                    });
                    if (request.method === "POST" && url.pathname === "/v1/sessions") {
                        const body = JSON.parse(Buffer.from(request.body).toString("utf8")) as {
                            metadata: string;
                        };
                        publishedMetadata = decryptHappyPayload(
                            secret,
                            "legacy",
                            Buffer.from(body.metadata, "base64"),
                        );
                        return json({
                            session: {
                                id: "happy-session-1",
                                metadata: body.metadata,
                                metadataVersion: 0,
                            },
                        });
                    }
                    if (
                        request.method === "POST" &&
                        url.pathname === "/v3/sessions/happy-session-1/messages"
                    ) {
                        return json({});
                    }
                    if (
                        request.method === "GET" &&
                        url.pathname === "/v3/sessions/happy-session-1/messages"
                    ) {
                        if (servedMobileMessage) return json({ hasMore: false, messages: [] });
                        servedMobileMessage = true;
                        return json({
                            hasMore: false,
                            messages: [
                                {
                                    content: { c: encryptedMobileMessage, t: "encrypted" },
                                    createdAt: 1,
                                    id: "mobile-message-1",
                                    localId: "mobile-local-1",
                                    seq: 1,
                                    updatedAt: 1,
                                },
                            ],
                        });
                    }
                    return {
                        response: {
                            body: "Happy test endpoint not implemented.",
                            status: 404,
                        },
                    };
                },
            },
            inference: [
                {
                    content: [{ text: "The Happy message reached Rig.", type: "text" }],
                },
            ],
            timeoutMs: 30_000,
        });
        running.add(gym);

        const screen = await gym.terminal.waitForText("The Happy message reached Rig.", 30_000);
        expect(screen.text).toContain("Continue from Happy mobile.");
        const request = gym.inference.requests.find(
            (candidate) => !candidate.options.sessionId?.endsWith(":title"),
        );
        expect(request?.context.messages.at(-1)).toMatchObject({
            content: [{ text: "Continue from Happy mobile.", type: "text" }],
            role: "user",
        });
        expect(publishedMetadata).toMatchObject({
            capabilities: { permissionModeSelection: true },
            currentOperatingModeCode: "full_access",
            operatingModes: [
                { code: "auto", kind: "safe-yolo", value: "Auto" },
                {
                    code: "workspace_write",
                    kind: "default",
                    value: "Workspace write",
                },
                { code: "read_only", kind: "read-only", value: "Read only" },
                { code: "full_access", kind: "yolo", value: "Full access" },
            ],
            permissionMode: "full_access",
        });
        const stored = await gym.runInContainer("node", [
            "-e",
            [
                'const {DatabaseSync}=require("node:sqlite")',
                'const db=new DatabaseSync("/home/rig/.server/sessions.sqlite")',
                'const row=db.prepare("select permission_mode from sessions limit 1").get()',
                "db.close()",
                "process.stdout.write(row.permission_mode)",
            ].join(";"),
        ]);
        expect(stored.stdout).toBe("read_only");
    }, 60_000);
});
