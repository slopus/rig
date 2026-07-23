import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Codex multi-turn captures", () => {
    it("captures SSE full-context turns, compaction, and a same-family model switch", async () => {
        const trace = await fixture("codex-gpt-5-6-multiturn.sse.json");
        expectLiveCompletedTrace(trace);
        expect(trace.requests).toHaveLength(4);
        expect(trace.requests.map((request: any) => request.model)).toEqual([
            "gpt-5.6-sol",
            "gpt-5.6-sol",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
        ]);
        expect(trace.requests.map((request: any) => request.previous_response_id)).toEqual([
            undefined,
            undefined,
            undefined,
            undefined,
        ]);
        expectLiveCompaction(trace, 2, 3, undefined);
        expect(lastUserText(trace.requests[3])).toBe(
            "After compaction. Reply with exactly SWITCHED.",
        );
    });

    it("captures WebSocket suffix reuse and full restarts for compaction and model switch", async () => {
        const trace = await fixture("codex-gpt-5-6-multiturn.websocket.json");
        expectLiveCompletedTrace(trace);
        expect(trace.requests).toHaveLength(5);
        expect(trace.requests[0].generate).toBe(false);
        expect(trace.requests[1].previous_response_id).toBe("<PREVIOUS_RESPONSE_ID>");
        expect(trace.requests[2].previous_response_id).toBe("<PREVIOUS_RESPONSE_ID>");
        expect(trace.requests[2].input).toHaveLength(1);
        expect(JSON.stringify(trace.requests[2].input)).not.toContain(
            "First turn. Reply with exactly FIRST.",
        );
        expect(lastUserText(trace.requests[2])).toBe("Second turn. Reply with exactly SECOND.");
        expectLiveCompaction(trace, 3, 4, "<PREVIOUS_RESPONSE_ID>");
        expect(trace.requests[4].model).toBe("gpt-5.6-terra");
        expect(trace.requests[4].previous_response_id).toBeUndefined();
    });

    it("captures the SSE transition from the 5.6 request shape to 5.5", async () => {
        const trace = await fixture("codex-gpt-5-6-to-5-5-multiturn.sse.json");
        expectLiveCompletedTrace(trace);
        expect(trace.requests).toHaveLength(5);
        expectLiveCompaction(trace, 2, 3, undefined);
        expectLiveCompaction(trace, 3, 4, undefined);
        const transition = trace.requests.at(-2);
        const switched = trace.requests.at(-1);
        expect(transition.model).toBe("gpt-5.6-sol");
        expect(transition.previous_response_id).toBeUndefined();
        expect(switched.model).toBe("gpt-5.5");
        expect(switched.previous_response_id).toBeUndefined();
        expect(switched.instructions).toBeTypeOf("string");
        expect(switched.tools).toBeInstanceOf(Array);
        expect(switched.input.some((item: any) => item.type === "additional_tools")).toBe(false);
        expect(JSON.stringify(switched.input)).toContain("<model_switch>");
    });

    it("captures the WebSocket transition from the 5.6 request shape to 5.5", async () => {
        const trace = await fixture("codex-gpt-5-6-to-5-5-multiturn.websocket.json");
        expectLiveCompletedTrace(trace);
        expect(trace.requests).toHaveLength(6);
        expectLiveCompaction(trace, 3, 4, "<PREVIOUS_RESPONSE_ID>");
        expectLiveCompaction(trace, 4, 5, undefined);
        const transition = trace.requests.at(-2);
        const switched = trace.requests.at(-1);
        expect(transition.model).toBe("gpt-5.6-sol");
        expect(transition.previous_response_id).toBeUndefined();
        expect(switched.model).toBe("gpt-5.5");
        expect(switched.previous_response_id).toBeUndefined();
        expect(switched.instructions).toBeTypeOf("string");
        expect(switched.tools).toBeInstanceOf(Array);
        expect(switched.input.some((item: any) => item.type === "additional_tools")).toBe(false);
        expect(JSON.stringify(switched.input)).toContain("<model_switch>");
    });
});

async function fixture(name: string): Promise<any> {
    return JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

function userTexts(request: any): string[] {
    return request.input
        .filter((item: any) => item.role === "user")
        .flatMap((item: any) =>
            Array.isArray(item.content)
                ? item.content.map((content: any) => content.text).filter(Boolean)
                : [item.content],
        );
}

function lastUserText(request: any): string | undefined {
    return userTexts(request).at(-1);
}

function expectLiveCompletedTrace(trace: any): void {
    expect(trace.source.capture).toBe("forwarded-live-inference");
    expect(trace.scenario.inference).toBe("live");
    expect(trace.responses).toHaveLength(trace.requests.length);
    expect(
        trace.responses.every((response: any) => response.terminal === "response.completed"),
    ).toBe(true);
}

function expectLiveCompaction(
    trace: any,
    compactionRequestIndex: number,
    followingRequestIndex: number,
    previousResponseId: string | undefined,
): void {
    const compaction = trace.requests[compactionRequestIndex];
    expect(compaction.previous_response_id).toBe(previousResponseId);
    expect(compaction.input.at(-1)).toEqual({ type: "compaction_trigger" });
    expect(trace.responses[compactionRequestIndex].terminal).toBe("response.completed");
    expect(trace.responses[compactionRequestIndex].outputItemTypes).toEqual(["compaction"]);
    expect(trace.responses[compactionRequestIndex].eventTypes).not.toContain(
        "response.output_text.delta",
    );
    expect(
        trace.requests[followingRequestIndex].input.some(
            (item: any) =>
                item.type === "compaction" && item.encrypted_content === "<ENCRYPTED_REASONING>",
        ),
    ).toBe(true);
    expect(JSON.stringify(trace.requests[followingRequestIndex].input)).not.toContain(
        "Another language model started",
    );
}
