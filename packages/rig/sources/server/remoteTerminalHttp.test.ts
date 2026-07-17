import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { ProtocolHttpClient } from "../client/ProtocolHttpClient.js";
import type { RemoteTerminalRow } from "../terminal/index.js";
import { createProtocolHttpServer } from "./createProtocolHttpServer.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("remote terminal HTTP API", () => {
    it("streams authoritative frames and serves scrollback for a host terminal", async () => {
        const { client, directory } = await startServer();
        const createdSession = await client.createSession({ cwd: directory });
        const created = await client.createRemoteTerminal(createdSession.session.id, {
            cols: 24,
            command: 'IFS= read -r value; printf "reply:%s\\n" "$value"',
            rows: 3,
        });
        const frames: number[] = [];
        const watching = client.watchRemoteTerminal(
            createdSession.session.id,
            created.terminal.id,
            {
                after: created.terminal.revision,
                onFrame(frame) {
                    frames.push(frame.revision);
                },
            },
        );

        await client.writeRemoteTerminal(createdSession.session.id, created.terminal.id, "hello\n");
        await watching;

        const current = await client.getRemoteTerminal(
            createdSession.session.id,
            created.terminal.id,
        );
        expect(current.terminal).toMatchObject({ exitCode: 0, status: "exited" });
        expect(frames.length).toBeGreaterThan(0);
        expect(frames).toEqual([...frames].sort((left, right) => left - right));

        const history = await client.getRemoteTerminalScrollback(
            createdSession.session.id,
            created.terminal.id,
            { limit: 20, start: 0 },
        );
        expect(history.viewport.rows.map(rowText).join("\n")).toContain("reply:hello");
        await expect(client.listRemoteTerminals(createdSession.session.id)).resolves.toMatchObject({
            terminals: [{ id: created.terminal.id, status: "exited" }],
        });
        const stopped = await client.stopRemoteTerminal(
            createdSession.session.id,
            created.terminal.id,
        );
        const finalFrames: number[] = [];
        await client.watchRemoteTerminal(createdSession.session.id, created.terminal.id, {
            after: stopped.terminal.revision,
            onFrame(frame) {
                finalFrames.push(frame.revision);
            },
        });
        expect(finalFrames).toEqual([stopped.terminal.revision]);
        await expect(
            client.getRemoteTerminalScrollback(createdSession.session.id, created.terminal.id, {
                limit: 20,
                start: 0,
            }),
        ).resolves.toMatchObject({ viewport: { revision: stopped.terminal.revision } });
    }, 60_000);
});

async function startServer(): Promise<{ client: ProtocolHttpClient; directory: string }> {
    const directory = await mkdtemp(join(tmpdir(), "rig-remote-terminal-"));
    const socketPath = join(directory, "daemon.sock");
    const server = createProtocolHttpServer({ token: "test-token" });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
    });
    cleanups.push(
        () =>
            new Promise<void>((resolve) => {
                server.close(() => {
                    void rm(directory, { force: true, recursive: true }).then(() => resolve());
                });
            }),
    );
    return {
        client: new ProtocolHttpClient({ socketPath, token: "test-token" }),
        directory,
    };
}

function rowText(row: RemoteTerminalRow): string {
    const cells = Array.from({ length: 512 }, () => " ");
    let width = 0;
    for (const cell of row.cells) {
        cells[cell.x] = cell.text;
        width = Math.max(width, cell.x + cell.width);
    }
    return cells.slice(0, width).join("").trimEnd();
}
