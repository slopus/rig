import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "../../packages/gym/sources/index.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("request debug logging", () => {
    it("captures inference streams and complete tool activity in ordered project files", async () => {
        let agentCall = 0;
        const gym = await createGym({
            args: ["--debug"],
            files: { "debug-seed.txt": "debug fixture\n" },
            inference(request) {
                if (request.options.sessionId?.endsWith(":title") === true) {
                    return { content: [{ text: "Debug capture", type: "text" }] };
                }
                agentCall += 1;
                if (agentCall === 1) {
                    return {
                        content: [
                            {
                                arguments: { cmd: "cat debug-seed.txt" },
                                id: "debug-tool-call",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                return { content: [{ text: "Debug capture complete.", type: "text" }] };
            },
        });
        running.add(gym);

        gym.terminal.type("Read the debug fixture.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Debug capture complete.", 30_000);

        const root = join(gym.workspacePath, ".rig", "debug");
        const requestDirectories = (await readdir(root, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        expect(requestDirectories).toHaveLength(1);
        expect(requestDirectories[0]).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_[a-zA-Z0-9_-]+$/u,
        );

        const directory = join(root, requestDirectories[0]!);
        const fileNames = (await readdir(directory))
            .filter((file) => file.endsWith(".json"))
            .sort();
        const records = await Promise.all(
            fileNames.map(
                async (file) =>
                    JSON.parse(await readFile(join(directory, file), "utf8")) as DebugRecord,
            ),
        );
        expect(records.map((record) => record.sequence)).toEqual(
            records.map((_record, index) => index + 1),
        );
        expect(records.map((record) => record.type)).toEqual(
            expect.arrayContaining([
                "request",
                "inference-request",
                "inference-event",
                "inference-response",
                "tool-call",
                "tool-raw-result",
                "tool-result",
                "agent-event",
                "agent-message",
                "run-finished",
            ]),
        );

        const request = records.find((record) => record.type === "request");
        expect(request?.data).toMatchObject({
            displayText: "Read the debug fixture.",
            request: { text: "Read the debug fixture." },
        });
        const inference = records.find(
            (record) => record.type === "inference-request" && record.data.source === "agent",
        );
        expect(inference?.data).toMatchObject({
            context: {
                messages: expect.arrayContaining([expect.objectContaining({ role: "user" })]),
            },
            model: { id: "openai/gym" },
            providerId: "gym",
        });
        const toolCall = records.find((record) => record.type === "tool-call");
        expect(toolCall?.data).toMatchObject({
            toolCall: {
                arguments: { cmd: "cat debug-seed.txt" },
                id: "debug-tool-call",
                name: "exec_command",
            },
        });
        const rawToolResult = records.find((record) => record.type === "tool-raw-result");
        expect(JSON.stringify(rawToolResult?.data.rawResult)).toContain("debug fixture");
        const toolResult = records.find((record) => record.type === "tool-result");
        expect(toolResult?.data).toMatchObject({
            result: {
                rendered: expect.arrayContaining([
                    expect.objectContaining({ text: expect.stringContaining("debug fixture") }),
                ]),
                toolCallId: "debug-tool-call",
                toolName: "exec_command",
            },
        });
        await expect(readFile(join(root, ".gitignore"), "utf8")).resolves.toBe("*\n");
    }, 120_000);
});

interface DebugRecord {
    data: Record<string, any>;
    sequence: number;
    type: string;
}
