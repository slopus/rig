import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import type { GymInferenceRequest } from "../../rig/sources/providers/gym-types.js";
import type { GymInferenceHandler, GymMockResponse } from "./types.js";

export class MockInferenceServer {
    readonly requests: GymInferenceRequest[] = [];
    readonly token = randomBytes(24).toString("hex");

    #agentCallIndex = 0;
    #handler: GymInferenceHandler;
    #server: Server | undefined;
    #url: string | undefined;

    constructor(inference: readonly GymMockResponse[] | GymInferenceHandler) {
        if (typeof inference === "function") {
            this.#handler = inference;
        } else {
            const responses = [...inference];
            this.#handler = (_request, callIndex) => {
                const response = responses[callIndex];
                if (response === undefined) {
                    return {
                        body: `No scripted inference response exists for agent call ${callIndex + 1}.`,
                        httpStatus: 500,
                    };
                }
                return response;
            };
        }
    }

    get url(): string {
        if (this.#url === undefined) throw new Error("Mock inference server has not started.");
        return this.#url;
    }

    async start(): Promise<void> {
        if (this.#server !== undefined) return;
        const server = createServer((request, response) => {
            void this.#respond(request, response);
        });
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "0.0.0.0", () => {
                server.off("error", reject);
                resolve();
            });
        });
        const address = server.address();
        if (address === null || typeof address === "string") {
            server.close();
            throw new Error("Mock inference server did not receive a TCP port.");
        }
        this.#server = server;
        this.#url = `http://host.docker.internal:${address.port}/inference`;
    }

    async stop(): Promise<void> {
        const server = this.#server;
        this.#server = undefined;
        this.#url = undefined;
        if (server === undefined) return;
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error === undefined ? resolve() : reject(error)));
        });
    }

    async #respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
        try {
            if (request.method !== "POST" || request.url !== "/inference") {
                send(response, 404, "Unknown gym inference route.");
                return;
            }
            if (request.headers.authorization !== `Bearer ${this.token}`) {
                send(response, 401, "Invalid gym inference token.");
                return;
            }
            const payload = JSON.parse(await readBody(request)) as GymInferenceRequest;
            this.requests.push(payload);
            const isTitle = payload.options.sessionId?.endsWith(":title") === true;
            const reply = isTitle
                ? {
                      content: [{ type: "text" as const, text: "Gym session" }],
                      stopReason: "stop" as const,
                  }
                : await this.#handler(payload, this.#agentCallIndex++);
            if ("httpStatus" in reply) {
                send(response, reply.httpStatus, reply.body ?? "Mock inference failure.");
                return;
            }
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(reply));
        } catch (error) {
            send(response, 500, error instanceof Error ? error.message : String(error));
        }
    }
}

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > 16 * 1024 * 1024) throw new Error("Gym inference request is too large.");
        chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, body: string): void {
    response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    response.end(body);
}
