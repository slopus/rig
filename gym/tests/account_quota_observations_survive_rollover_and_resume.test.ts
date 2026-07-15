import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "../../packages/gym/sources/index.js";

const running = new Set<Gym>();
const artifacts = resolve(import.meta.dirname, "../../artifacts/session-usage");
const rig = "node /app/packages/rig/dist/main.js";
const claudeQuotaExecutable = "fake-claude-quota.mjs";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("account quota observations", () => {
    it("separates providers, ignores rollover deltas, and does not double count on resume", async () => {
        await mkdir(artifacts, { recursive: true });
        const epoch = Math.floor(Date.now() / 1_000) + 18_000;
        const nextEpoch = epoch + 18_000;
        const claudeSnapshots = [
            claudeQuota(40, 20, epoch),
            claudeQuota(42, 22, epoch),
            claudeQuota(45, 25, epoch),
            claudeQuota(42, 22, epoch),
            claudeQuota(2, 1, nextEpoch),
            claudeQuota(2, 1, nextEpoch),
            claudeQuota(4, 2, nextEpoch),
        ];
        const codexSnapshots = [
            codexQuota(20, 10, epoch),
            codexQuota(23, 11, epoch),
            codexQuota(30, 15, epoch),
        ];
        let codexQuotaIndex = 0;
        const gym = await createGym({
            cols: 64,
            entrypoint: ["bash", "-lc", `${rig}; echo QUOTA_RESUMED; exec ${rig} resume --last`],
            environment: {
                NO_PROXY: "host.docker.internal",
                RIG_CLAUDE_CODE_EXECUTABLE: `/workspace/${claudeQuotaExecutable}`,
                RIG_CODEX_BASE_URL: "{{HTTP_PROXY_URL}}/backend-api",
                RIG_FAKE_CLAUDE_QUOTAS: JSON.stringify(claudeSnapshots),
            },
            files: { [claudeQuotaExecutable]: fakeClaudeQuotaExecutable() },
            homeFiles: {
                ".codex/auth.json": JSON.stringify({
                    auth_mode: "chatgpt",
                    tokens: { access_token: fakeJwt(), account_id: "quota-account" },
                }),
            },
            httpProxy: {
                handler(request) {
                    if (
                        request.method === "GET" &&
                        new URL(request.url).pathname === "/backend-api/wham/usage"
                    ) {
                        const snapshot =
                            codexSnapshots[Math.min(codexQuotaIndex, codexSnapshots.length - 1)];
                        codexQuotaIndex += 1;
                        return {
                            response: {
                                body: JSON.stringify(snapshot),
                                headers: { "content-type": "application/json" },
                                status: 200,
                            },
                        };
                    }
                    return { response: { body: "Unexpected quota request", status: 404 } };
                },
            },
            inference(request, callIndex) {
                const outputs = [100, 200, 50, 25];
                expect(["codex", "claude-sdk"]).toContain(request.providerId);
                return {
                    content: [{ text: `QUOTA_TURN_${callIndex}`, type: "text" }],
                    usage: usage(outputs[callIndex] ?? 1),
                };
            },
            modelId: "openai/gpt-5.6-sol",
            providerId: "codex",
            providerOverrides: ["codex", "claude-sdk"],
            rows: 45,
        });
        running.add(gym);

        await submitAndWait(gym, "Record Codex quota movement.");
        submit(gym, "/model");
        await gym.terminal.waitForText("Choose Model");
        for (let index = 0; index < 5; index += 1) gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Choose Reasoning");
        gym.terminal.press("enter");
        await gym.terminal.waitUntil(
            (screen) => !screen.text.includes("Choose Reasoning"),
            "Claude model selection",
            30_000,
        );

        await submitAndWait(gym, "Record Claude quota movement.");
        await waitForQuotaRequests(gym, 2);
        await expect(gym.readFile("claude-quota-requests.log")).resolves.toContain('"fiveHour":42');
        submit(gym, "/usage");
        const bothProviders = await gym.terminal.waitUntil(
            (screen) =>
                screen.text.includes("Codex") &&
                screen.text.includes("5-hour: 70% left") &&
                screen.text.includes("Weekly: 85% left") &&
                screen.text.includes("Claude") &&
                screen.text.includes("5-hour: 55% left") &&
                screen.text.includes("Weekly: 75% left") &&
                screen.text.includes("Observed while this session was active: +3%") &&
                screen.text.includes("Observed while this session was active: +2%") &&
                screen.text.includes("Overall session total: 300") &&
                !screen.synchronizedOutputActive,
            "independent Codex and Claude quota windows",
            30_000,
        );
        expect(bothProviders.text).toContain("Observed while this session was active: +1%");
        expect(bothProviders.text).not.toContain("�");
        await repaint(gym);
        await gym.terminal.screenshot(`${artifacts}/codex-claude-weekly-observed-narrow.png`);

        gym.terminal.resize(64, 60);
        gym.terminal.press("ctrlD");
        await gym.terminal.waitForText("QUOTA_RESUMED", 30_000);
        await gym.terminal.waitForText("Ask Rig to do anything", 30_000);
        submit(gym, "/usage");
        const resumed = await gym.terminal.waitUntil(
            (screen) =>
                screen.text.lastIndexOf("Usage Codex") > screen.text.lastIndexOf("QUOTA_TURN_1") &&
                screen.text.includes("Overall session total: 300"),
            "resumed quota report",
            30_000,
        );
        expect(resumed.text).toContain("Observed while this session was active: +3%");
        expect(resumed.text).toContain("Observed while this session was active: +2%");
        expect(resumed.text).not.toContain("Observed while this session was active: +6%");
        expect(resumed.text).not.toContain("Observed while this session was active: +4%");
        await gym.terminal.screenshot(`${artifacts}/quota-resume-no-double-count.png`);
        await repaint(gym);

        await submitAndWait(gym, "Cross the account window reset.");
        await waitForQuotaRequests(gym, 5);
        await submitAndWait(gym, "Confirm the new window baseline.");
        await waitForQuotaRequests(gym, 7);
        submit(gym, "/usage");
        const rollover = await gym.terminal.waitUntil(
            (screen) =>
                screen.text.includes("Overall session total: 375") &&
                screen.text.includes("5-hour: 96% left") &&
                screen.text.includes("Weekly: 98% left") &&
                screen.text.includes("Observed while this session was active: +4%") &&
                screen.text.includes("Observed while this session was active: +3%") &&
                !screen.synchronizedOutputActive &&
                screen.scroll.atBottom,
            "rollover-safe observed movement",
            30_000,
        );
        await repaint(gym);
        await gym.terminal.screenshot(`${artifacts}/quota-rollover-observed-only.png`);
        expect(rollover.text).not.toContain("+95%");
    }, 180_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

async function submitAndWait(gym: Gym, prompt: string): Promise<void> {
    submit(gym, prompt);
    await gym.terminal.waitUntil(
        (screen) => {
            const promptIndex = screen.text.lastIndexOf(prompt);
            return (
                promptIndex >= 0 && screen.text.lastIndexOf("Ask Rig to do anything") > promptIndex
            );
        },
        `settled turn for ${prompt}`,
        30_000,
    );
}

async function repaint(gym: Gym, rows = 45): Promise<void> {
    gym.terminal.resize(65, rows);
    gym.terminal.resize(64, rows);
    await gym.terminal.waitUntil(
        (screen) => !screen.synchronizedOutputActive && screen.scroll.atBottom,
        "settled narrow repaint",
        30_000,
    );
}

async function waitForQuotaRequests(gym: Gym, expected: number): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const count = await gym
            .readFile("claude-quota-requests.log")
            .then((text) => text.trim().split("\n").length)
            .catch(() => 0);
        if (count >= expected) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${expected} Claude quota requests.`);
}

function usage(output: number) {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output,
        totalTokens: output,
    };
}

function codexQuota(fiveHour: number, weekly: number, resetAt: number) {
    return {
        rate_limit: {
            primary_window: {
                limit_window_seconds: 18_000,
                reset_at: resetAt,
                used_percent: fiveHour,
            },
            secondary_window: {
                limit_window_seconds: 604_800,
                reset_at: resetAt + 604_800,
                used_percent: weekly,
            },
        },
    };
}

function claudeQuota(fiveHour: number, weekly: number, resetAt: number) {
    return {
        rate_limits_available: true,
        rate_limits: {
            five_hour: {
                resets_at: new Date(resetAt * 1_000).toISOString(),
                utilization: fiveHour,
            },
            seven_day: {
                resets_at: new Date((resetAt + 604_800) * 1_000).toISOString(),
                utilization: weekly,
            },
        },
        session: {
            model_usage: {},
            total_api_duration_ms: 0,
            total_cost_usd: 0,
            total_duration_ms: 0,
            total_lines_added: 0,
            total_lines_removed: 0,
        },
        subscription_type: "pro",
    };
}

function fakeClaudeQuotaExecutable(): string {
    return String.raw`
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const counterPath = "/tmp/rig-fake-claude-quota-counter";
const snapshots = JSON.parse(process.env.RIG_FAKE_CLAUDE_QUOTAS ?? "[]");
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.type !== "control_request") continue;
    let response = {};
    if (message.request?.subtype === "get_usage") {
        let index = 0;
        try { index = Number(await readFile(counterPath, "utf8")); } catch {}
        response = snapshots[Math.min(index, snapshots.length - 1)];
        await writeFile(counterPath, String(index + 1));
        await appendFile("/workspace/claude-quota-requests.log", JSON.stringify({
            fiveHour: response?.rate_limits?.five_hour?.utilization,
            index,
            weekly: response?.rate_limits?.seven_day?.utilization,
        }) + "\n");
    }
    process.stdout.write(JSON.stringify({
        type: "control_response",
        response: {
            subtype: "success",
            request_id: message.request_id,
            response,
        },
    }) + "\n");
}
`;
}

function fakeJwt(): string {
    return [
        Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
        Buffer.from(
            JSON.stringify({
                "https://api.openai.com/auth": {
                    chatgpt_account_id: "quota-account",
                },
            }),
        ).toString("base64url"),
        "signature",
    ].join(".");
}
