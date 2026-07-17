import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Ctrl-C input to a running shell", () => {
    it("interrupts the foreground work and leaves the session available for later input", async () => {
        const script = [
            'process.stdin.setEncoding("utf8");',
            'process.on("SIGINT", () => process.stdout.write("INTERRUPTED_WITHOUT_EXITING\\n"));',
            'process.stdin.on("data", (input) => {',
            "    process.stdout.write(`RECEIVED_AFTER_INTERRUPT:${input.trim()}\\n`);",
            '    if (input.includes("continue")) process.exit(0);',
            "});",
            "setInterval(() => {}, 1_000);",
        ].join(" ");
        let sessionId: number | undefined;
        const gym = await createGym({
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                const resultText = messageText(lastMessage?.content);

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: `node -e ${shellQuote(script)}`,
                                    yield_time_ms: 250,
                                },
                                id: "start-interruptible-shell-session",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    const match = resultText.match(/Process running with session ID (\d+)/u);
                    expect(match).not.toBeNull();
                    sessionId = Number(match?.[1]);
                    return {
                        content: [
                            {
                                arguments: {
                                    chars: "\u0003",
                                    session_id: sessionId,
                                    yield_time_ms: 1_000,
                                },
                                id: "interrupt-shell-session",
                                name: "write_stdin",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 2) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "write_stdin",
                    });
                    expect(resultText).toContain("INTERRUPTED_WITHOUT_EXITING");
                    expect(resultText).toContain("Process running with session ID");
                    return {
                        content: [
                            {
                                arguments: {
                                    chars: "continue\n",
                                    session_id: sessionId,
                                    yield_time_ms: 2_000,
                                },
                                id: "continue-interrupted-shell-session",
                                name: "write_stdin",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(3);
                expect(lastMessage).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "write_stdin",
                });
                expect(resultText).toContain("RECEIVED_AFTER_INTERRUPT:continue");
                return { content: [{ text: "SHELL_INTERRUPT_FLOW_COMPLETE", type: "text" }] };
            },
            permissionMode: "full_access",
            rows: 26,
        });
        running.add(gym);

        gym.terminal.type("Interrupt the running command, then continue the same shell session.");
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("SHELL_INTERRUPT_FLOW_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the interrupted shell session to accept later input",
            30_000,
        );

        expect(sessionId).toBeTypeOf("number");
        expect(completed.text).not.toContain("Tool 'write_stdin' failed");
    }, 120_000);
});

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter(
            (block): block is { text: string; type: "text" } =>
                typeof block === "object" &&
                block !== null &&
                "type" in block &&
                block.type === "text" &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("");
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
