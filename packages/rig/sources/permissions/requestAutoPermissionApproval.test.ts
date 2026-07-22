import { describe, expect, it, vi } from "vitest";

import type { UserInputContext } from "../agent/context/UserInputContext.js";
import { requestAutoPermissionApproval } from "./requestAutoPermissionApproval.js";

describe("requestAutoPermissionApproval", () => {
    it.each([
        { durable: undefined, persists: true },
        { durable: false, persists: false },
    ])(
        "persists ordinary prompts but not nested Code Mode prompts",
        async ({ durable, persists }) => {
            const request = vi.fn<UserInputContext["request"]>(async () => ({
                answers: { permission: ["Allow once"] },
            }));

            await expect(
                requestAutoPermissionApproval({
                    action: "write the file",
                    batchId: "batch",
                    ...(durable === undefined ? {} : { durable }),
                    reason: "The user requested it.",
                    toolArguments: { path: "result.txt" },
                    toolCallId: "tool-call",
                    toolCallIndex: 0,
                    toolName: "write",
                    userInput: { request },
                }),
            ).resolves.toBe(true);

            const options = request.mock.calls[0]?.[1];
            if (persists) {
                expect(options?.durable).toMatchObject({
                    batchId: "batch",
                    toolCallId: "tool-call",
                    toolName: "write",
                });
            } else {
                expect(options).not.toHaveProperty("durable");
            }
        },
    );
});
