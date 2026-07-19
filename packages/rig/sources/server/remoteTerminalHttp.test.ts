import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProtocolHttpClient } from "../client/ProtocolHttpClient.js";
import { createProtocolHttpServer } from "./createProtocolHttpServer.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("remote terminal WebSocket protocol", () => {
    it("attaches over a Unix-socket WebSocket and carries PTY output, input, exit, and scrollback", async () => {
        const { client, directory } = await startServer();
        const createdSession = await client.createSession({ cwd: directory });
        const created = await client.createRemoteTerminal(createdSession.session.id, {
            cols: 24,
            command: 'IFS= read -r value; printf "reply:%s\\n" "$value"',
            rows: 3,
        });
        const attachment = await client.attachRemoteTerminal(
            createdSession.session.id,
            created.terminal.id,
            { clientId: "primary-viewer" },
        );

        attachment.writeInput("hello\n");
        await expect(attachment.exited).resolves.toBe(0);
        await vi.waitFor(() => {
            expect(attachment.terminal.snapshot().rows.map(rowText).join("\n")).toContain(
                "reply:hello",
            );
        });

        const page = await attachment.requestScrollback(0, 20);
        expect(page.rows.map(gridRowText).join("\n")).toContain("reply:hello");
        expect(page.historyEpoch).toBeTruthy();
        await expect(client.listRemoteTerminals(createdSession.session.id)).resolves.toMatchObject({
            terminals: [{ id: created.terminal.id, status: "exited" }],
        });

        const late = await client.attachRemoteTerminal(
            createdSession.session.id,
            created.terminal.id,
            { clientId: "late-viewer" },
        );
        await expect(late.exited).resolves.toBe(0);
        expect(late.terminal.snapshot().rows.map(rowText).join("\n")).toContain("reply:hello");
    }, 60_000);

    it("rejects lease reuse, resumes input after a dropped client, broadcasts resize, and enforces auth", async () => {
        const { client, directory, socketPath } = await startServer();
        const createdSession = await client.createSession({ cwd: directory });
        const created = await client.createRemoteTerminal(createdSession.session.id, {
            cols: 20,
            command: 'while IFS= read -r value; do printf "[%s]\\n" "$value"; done',
            rows: 4,
        });
        const first = await client.attachRemoteTerminal(
            createdSession.session.id,
            created.terminal.id,
            { clientId: "reconnecting-viewer" },
        );
        const reconnectState = first.reconnectState();

        await expect(
            client.attachRemoteTerminal(createdSession.session.id, created.terminal.id, {
                clientId: "duplicate-viewer",
                reconnectState,
            }),
        ).rejects.toThrow("already attached");

        first.close();
        const resumed = await client.attachRemoteTerminal(
            createdSession.session.id,
            created.terminal.id,
            {
                clientId: "reconnecting-viewer",
                reconnectState,
                replica: first.replica,
            },
        );
        resumed.writeInput("after-reconnect\n");
        await vi.waitFor(() => {
            expect(resumed.terminal.snapshot().rows.map(rowText).join("\n")).toContain(
                "[after-reconnect]",
            );
        });
        const watcher = await client.attachRemoteTerminal(
            createdSession.session.id,
            created.terminal.id,
            { clientId: "resize-watcher" },
        );
        await expect(
            client.resizeRemoteTerminal(createdSession.session.id, created.terminal.id, {
                cols: 30,
                rows: 6,
            }),
        ).resolves.toMatchObject({ terminal: { cols: 30, rows: 6 } });
        await vi.waitFor(() => {
            expect(resumed.terminal.snapshot()).toMatchObject({ cols: 30, visibleRows: 6 });
            expect(watcher.terminal.snapshot()).toMatchObject({ cols: 30, visibleRows: 6 });
        });
        const lateAfterResize = await client.attachRemoteTerminal(
            createdSession.session.id,
            created.terminal.id,
            { clientId: "late-after-resize" },
        );
        expect(lateAfterResize.protocol.mode).toBe("grid");
        await vi.waitFor(() => expect(lateAfterResize.replica.grid).toMatchObject({ cols: 30 }));
        const pagingBasis = await lateAfterResize.requestScrollback(0, 10);
        resumed.writeInput("shift-history\n");
        await vi.waitFor(() => {
            expect(resumed.terminal.snapshot().rows.map(rowText).join("\n")).toContain(
                "[shift-history]",
            );
        });
        await expect(
            lateAfterResize.requestScrollback(0, 10, {
                historyEpoch: pagingBasis.historyEpoch,
                historyRevision: pagingBasis.historyRevision,
            }),
        ).rejects.toThrow("stale");

        const unauthorized = new ProtocolHttpClient({ socketPath, token: "wrong-token" });
        await expect(
            unauthorized.attachRemoteTerminal(createdSession.session.id, created.terminal.id, {
                clientId: "unauthorized",
            }),
        ).rejects.toThrow(/401|Unauthorized/i);

        await client.stopRemoteTerminal(createdSession.session.id, created.terminal.id);
        await expect(resumed.exited).resolves.toBeTypeOf("number");
    }, 60_000);
});

async function startServer(): Promise<{
    client: ProtocolHttpClient;
    directory: string;
    socketPath: string;
}> {
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
                server.closeAllConnections();
                server.close(() => {
                    void rm(directory, { force: true, recursive: true }).then(() => resolve());
                });
            }),
    );
    return {
        client: new ProtocolHttpClient({ socketPath, token: "test-token" }),
        directory,
        socketPath,
    };
}

function rowText(row: { cells: readonly { text: string; width: number; x: number }[] }): string {
    const cells = Array.from({ length: 512 }, () => " ");
    let width = 0;
    for (const cell of row.cells) {
        cells[cell.x] = cell.text;
        width = Math.max(width, cell.x + cell.width);
    }
    return cells.slice(0, width).join("").trimEnd();
}

function gridRowText(row: {
    cells: readonly { text: string; width: number; x: number }[];
}): string {
    return rowText(row);
}
