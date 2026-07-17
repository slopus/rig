import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("background shell output after the retention cap", () => {
    it("keeps the recent tail and returns output produced after a prior read", async () => {
        const script = [
            'process.stdout.write("A".repeat(5_000) + "FIRST_TAIL_MARKER\\n");',
            'process.stdin.once("data", () => {',
            '    process.stdout.write("SECOND_OUTPUT_MARKER\\n");',
            "    process.exit(0);",
            "});",
        ].join(" ");
        let firstResult = "";
        let sessionId: number | undefined;
        const gym = await createGym({
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                const resultText =
                    typeof lastMessage?.content === "string"
                        ? lastMessage.content
                        : (lastMessage?.content ?? [])
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join("");

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: `node -e ${shellQuote(script)}`,
                                    max_output_tokens: 1_000,
                                    yield_time_ms: 250,
                                },
                                id: "fill-output-retention-buffer",
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
                    firstResult = resultText;
                    const match = resultText.match(/Process running with session ID (\d+)/u);
                    expect(match).not.toBeNull();
                    sessionId = Number(match?.[1]);
                    return {
                        content: [
                            {
                                arguments: {
                                    chars: "continue\n",
                                    max_output_tokens: 1_000,
                                    session_id: sessionId,
                                    yield_time_ms: 2_000,
                                },
                                id: "continue-after-output-cap",
                                name: "write_stdin",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(lastMessage).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "write_stdin",
                });
                expect(firstResult).toContain("FIRST_TAIL_MARKER");
                expect(resultText).toContain("SECOND_OUTPUT_MARKER");
                return {
                    content: [{ text: "CAPPED_OUTPUT_FLOW_COMPLETE", type: "text" }],
                };
            },
            rows: 26,
        });
        running.add(gym);

        gym.terminal.type("Run the long-output command and then continue it.");
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CAPPED_OUTPUT_FLOW_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the continued output after the retention cap",
            30_000,
        );

        expect(sessionId).toBeTypeOf("number");
        expect(completed.rows).toHaveLength(26);
        expect(completed.text).not.toContain("�");
        expect(completed.text).toContain("gym off · /workspace");
    }, 120_000);
});

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
