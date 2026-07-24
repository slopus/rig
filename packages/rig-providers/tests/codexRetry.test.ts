import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexProvider } from "@/vendors/codex/CodexProvider.js";
import { formatCodexUserAgent } from "@/vendors/codex/impl/codexUserAgent.js";
import { isRetryableCodexStreamError } from "@/vendors/codex/impl/isRetryableCodexStreamError.js";
import { isCodexPreviousResponseNotFoundError } from "@/vendors/codex/impl/isCodexPreviousResponseNotFoundError.js";
import { isCodexWebSocketUnavailableError } from "@/vendors/codex/impl/isCodexWebSocketUnavailableError.js";
import { resolveCodexInstallationId } from "@/vendors/codex/impl/resolveCodexInstallationId.js";
import { resolveCodexInstallationIdAt } from "@/vendors/codex/impl/resolveCodexInstallationIdAt.js";
import { resolveCodexRetryDelay } from "@/vendors/codex/impl/resolveCodexRetryDelay.js";
import { resolveCodexStreamIdleTimeout } from "@/vendors/codex/impl/resolveCodexStreamIdleTimeout.js";
import { resolveCodexStreamMaxRetries } from "@/vendors/codex/impl/resolveCodexStreamMaxRetries.js";
import { waitForCodexRetry } from "@/vendors/codex/impl/waitForCodexRetry.js";

describe("Codex stream retries", () => {
    it("recognizes a missing previous response from structured and serialized API errors", () => {
        const responseError = {
            type: "invalid_request_error",
            code: "previous_response_not_found",
            message: "Previous response was not found.",
            param: "previous_response_id",
        };

        expect(
            isCodexPreviousResponseNotFoundError({
                error: responseError,
                status: 400,
            }),
        ).toBe(true);
        expect(
            isCodexPreviousResponseNotFoundError(
                new Error(JSON.stringify({ type: "error", error: responseError, status: 400 })),
            ),
        ).toBe(true);
        expect(
            isCodexPreviousResponseNotFoundError(
                Object.assign(new Error("invalid request"), { status: 400 }),
            ),
        ).toBe(false);
    });

    it("formats the native user agent from runtime identity", () => {
        expect(
            formatCodexUserAgent({
                architecture: "arm64",
                osType: "Mac OS",
                osVersion: "26.5.2",
                terminal: "unknown",
                version: "0.145.0",
            }),
        ).toBe("codex_exec/0.145.0 (Mac OS 26.5.2; arm64) unknown (codex_exec; 0.145.0)");
    });

    it.each([
        Object.assign(new Error("request failed"), { status: 408 }),
        Object.assign(new Error("request failed"), { status: 429 }),
        Object.assign(new Error("request failed"), { status: 500 }),
        Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
        Object.assign(new Error("request failed"), { name: "APIConnectionError" }),
        Object.assign(new TypeError("request failed"), {
            cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
        }),
        new Error("socket disconnected"),
    ])("recognizes retryable transport errors", (error) => {
        expect(isRetryableCodexStreamError(error)).toBe(true);
    });

    it.each([
        new Error("invalid response payload"),
        Object.assign(new Error("bad request"), { status: 400 }),
        Object.assign(new Error("unauthorized"), { status: 401 }),
        new DOMException("Request was aborted", "AbortError"),
    ])("does not retry semantic or programming errors", (error) => {
        expect(isRetryableCodexStreamError(error)).toBe(false);
    });

    it("rejects a retry delay immediately when already aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(waitForCodexRetry(100, undefined, controller.signal)).rejects.toMatchObject({
            name: "AbortError",
        });
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
        "rejects an invalid retry limit",
        (value) => {
            expect(() => resolveCodexStreamMaxRetries(value)).toThrow(
                "streamMaxRetries must be a finite nonnegative integer.",
            );
            expect(
                () =>
                    new CodexProvider({
                        credential: {
                            name: "codex-api-key",
                            credential: { apiKey: "test" },
                        },
                        streamMaxRetries: value,
                    }),
            ).toThrow("streamMaxRetries must be a finite nonnegative integer.");
        },
    );

    it("caps retry limits to the upstream maximum", () => {
        expect(resolveCodexStreamMaxRetries(101)).toBe(100);
    });

    it("uses one persisted installation identity across sessions", async () => {
        const first = await resolveCodexInstallationId();
        const second = await resolveCodexInstallationId();
        expect(first).toBe(second);
        expect(first).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        );
    });

    it("creates one durable installation identity across concurrent resolvers", async () => {
        const codexHome = await mkdtemp(join(tmpdir(), "rig-codex-installation-"));
        try {
            const resolved = await Promise.all(
                Array.from({ length: 20 }, () => resolveCodexInstallationIdAt(codexHome)),
            );
            expect(new Set(resolved)).toEqual(new Set([resolved[0]]));
            expect((await readFile(join(codexHome, "installation_id"), "utf8")).trim()).toBe(
                resolved[0],
            );
            await chmod(join(codexHome, "installation_id"), 0o600);
            expect(await resolveCodexInstallationIdAt(codexHome)).toBe(resolved[0]);
            expect((await stat(join(codexHome, "installation_id"))).mode & 0o777).toBe(0o644);
        } finally {
            await rm(codexHome, { force: true, recursive: true });
        }
    });

    it("uses the upstream stream idle timeout and validates overrides", () => {
        expect(resolveCodexStreamIdleTimeout()).toBe(300_000);
        expect(resolveCodexStreamIdleTimeout(25)).toBe(25);
        expect(() => resolveCodexStreamIdleTimeout(0)).toThrow(
            "streamIdleTimeoutMs must be a finite positive integer.",
        );
    });

    it("honors explicit server retry directives before status defaults", () => {
        expect(
            isRetryableCodexStreamError({
                status: 500,
                headers: new Headers({ "x-should-retry": "false" }),
            }),
        ).toBe(false);
        expect(
            isRetryableCodexStreamError({
                status: 400,
                headers: { "x-should-retry": "true" },
            }),
        ).toBe(true);
    });

    it("uses bounded server retry delays before exponential backoff", () => {
        expect(
            resolveCodexRetryDelay(1, {
                headers: new Headers({ "retry-after-ms": "1750" }),
            }),
        ).toBe(1_750);
        expect(resolveCodexRetryDelay(2, { headers: { "retry-after": "1.25" } })).toBe(1_250);
        expect(resolveCodexRetryDelay(3, undefined, () => 0.5)).toBe(800);
        expect(
            resolveCodexRetryDelay(1, { headers: { "retry-after-ms": "999999" } }, () => 0.5),
        ).toBe(200);
    });

    it("separates WebSocket capability failures from inference retryability", () => {
        expect(isCodexWebSocketUnavailableError({ status: 404 })).toBe(true);
        expect(isCodexWebSocketUnavailableError({ status: 405 })).toBe(true);
        expect(isCodexWebSocketUnavailableError({ status: 426 })).toBe(true);
        expect(
            isCodexWebSocketUnavailableError({
                status: 400,
                message: "Responses WebSocket is not supported.",
            }),
        ).toBe(true);
        expect(isCodexWebSocketUnavailableError({ status: 400, message: "Invalid input" })).toBe(
            false,
        );
        expect(
            isCodexWebSocketUnavailableError({
                status: 400,
                message: "Request failed",
                cause: new Error("Responses WebSocket is unavailable."),
            }),
        ).toBe(true);
    });

    it("never retries an abort hidden under a retryable transport wrapper", () => {
        const abort = new DOMException("Request was aborted", "AbortError");
        expect(
            isRetryableCodexStreamError(
                Object.assign(new Error("socket disconnected", { cause: abort }), {
                    code: "ECONNRESET",
                }),
            ),
        ).toBe(false);
    });
});
