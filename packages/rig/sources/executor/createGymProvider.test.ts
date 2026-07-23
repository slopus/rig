import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

import { createGymProvider, gymModel } from "./createGymProvider.js";

describe("createGymProvider", () => {
    it("normalizes a host response into provider streaming events", async () => {
        const requests: unknown[] = [];
        const server = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => {
                requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                expect(request.headers.authorization).toBe("Bearer secret");
                response.writeHead(200, { "content-type": "application/json" });
                response.end(
                    JSON.stringify({
                        content: [{ text: "hello", type: "text" }],
                        stopReason: "stop",
                    }),
                );
            });
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("Missing port.");
        try {
            const provider = createGymProvider({
                endpoint: `http://127.0.0.1:${address.port}`,
                token: "secret",
            });
            expect(provider.serviceTiers).toEqual(["fast"]);
            const stream = provider.stream(
                gymModel,
                { messages: [{ content: "Hi", role: "user", timestamp: 1 }] },
                { sessionId: "session-1", thinking: "off" },
            );
            const events = [];
            for await (const event of stream) events.push(event);

            await expect(stream.result()).resolves.toMatchObject({
                content: [{ text: "hello", type: "text" }],
                provider: "gym",
                stopReason: "stop",
            });
            expect(events.map((event) => event.type)).toEqual([
                "start",
                "text_start",
                "text_delta",
                "text_end",
                "done",
            ]);
            expect(requests).toMatchObject([
                {
                    modelId: "openai/gym",
                    options: { sessionId: "session-1", thinking: "off" },
                },
            ]);
        } finally {
            server.close();
        }
    });

    it("surfaces mocked HTTP failures", async () => {
        const server = createServer((_request, response) => {
            response.writeHead(429);
            response.end("scripted overload");
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("Missing port.");
        try {
            const provider = createGymProvider({
                endpoint: `http://127.0.0.1:${address.port}`,
            });
            const stream = provider.stream(gymModel, { messages: [] });
            await expect(stream.result()).rejects.toThrow("HTTP 429: scripted overload");
        } finally {
            server.close();
        }
    });
});
