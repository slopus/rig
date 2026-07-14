import { createServer, request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { InterceptingHttpProxy } from "./InterceptingHttpProxy.js";

const running = new Set<InterceptingHttpProxy>();

afterEach(async () => {
    await Promise.all([...running].map((proxy) => proxy.stop()));
    running.clear();
});

describe("InterceptingHttpProxy", () => {
    it("records requests and can replace responses without contacting the target", async () => {
        const proxy = new InterceptingHttpProxy((intercepted) => ({
            response: {
                body: `replaced ${Buffer.from(intercepted.body).toString("utf8")}`,
                headers: { "content-type": "text/plain" },
                status: 201,
            },
        }));
        running.add(proxy);
        await proxy.start();

        const response = await sendThroughProxy(proxy, "http://unreachable.invalid/messages", "hi");

        expect(response).toEqual({ body: "replaced hi", status: 201 });
        expect(proxy.exchanges).toHaveLength(1);
        expect(proxy.exchanges[0]).toMatchObject({
            request: { method: "POST", url: "http://unreachable.invalid/messages" },
            response: { status: 201 },
            responseSource: "interceptor",
        });
    });

    it("can rewrite a request, pass it upstream, and rewrite the upstream response", async () => {
        const upstream = createServer(async (incoming, response) => {
            const chunks: Buffer[] = [];
            for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
            response.writeHead(202, { "x-upstream": "yes" });
            response.end(`upstream ${Buffer.concat(chunks).toString("utf8")}`);
        });
        await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
        const address = upstream.address();
        if (address === null || typeof address === "string") throw new Error("No upstream port.");

        const proxy = new InterceptingHttpProxy(() => ({
            request: {
                body: "rewritten request",
                url: `http://127.0.0.1:${address.port}/rewritten`,
            },
            transformResponse: (response) => ({
                body: `rewritten ${Buffer.from(response.body).toString("utf8")}`,
                headers: { "x-intercepted": "yes" },
                status: 203,
            }),
        }));
        running.add(proxy);

        try {
            await proxy.start();
            const response = await sendThroughProxy(
                proxy,
                "http://original.invalid/original",
                "original request",
            );

            expect(response).toEqual({
                body: "rewritten upstream rewritten request",
                status: 203,
            });
            expect(proxy.exchanges[0]).toMatchObject({
                forwardedRequest: {
                    url: `http://127.0.0.1:${address.port}/rewritten`,
                },
                request: { url: "http://original.invalid/original" },
                response: { status: 203 },
                responseSource: "interceptor",
            });
        } finally {
            await new Promise<void>((resolve, reject) => {
                upstream.close((error) => (error === undefined ? resolve() : reject(error)));
            });
        }
    });
});

function sendThroughProxy(
    proxy: InterceptingHttpProxy,
    target: string,
    body: string,
): Promise<{ body: string; status: number }> {
    const proxyUrl = new URL(proxy.url.replace("host.docker.internal", "127.0.0.1"));
    return new Promise((resolve, reject) => {
        const outgoing = request(
            {
                headers: { "content-type": "text/plain" },
                host: proxyUrl.hostname,
                method: "POST",
                path: target,
                port: Number(proxyUrl.port),
            },
            async (response) => {
                const chunks: Buffer[] = [];
                for await (const chunk of response) chunks.push(Buffer.from(chunk));
                resolve({
                    body: Buffer.concat(chunks).toString("utf8"),
                    status: response.statusCode ?? 0,
                });
            },
        );
        outgoing.once("error", reject);
        outgoing.end(body);
    });
}
