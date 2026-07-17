import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const WORKFLOW_TOOLS = [
    "workflow",
    "wait_for_workflow",
    "workflow_status",
    "stop_workflow",
] as const;
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("repository workflow settings", () => {
    it("can enable workflows when the user default is disabled", async () => {
        const gym = await createWorkflowSettingGym({
            expected: true,
            globalSetting: false,
            projectSetting: true,
        });
        running.add(gym);

        submit(gym, "Check whether workflows are available here.");
        await gym.terminal.waitForText("WORKFLOWS_ENABLED", 30_000);
    }, 120_000);

    it("can disable workflows when the user default is enabled", async () => {
        const gym = await createWorkflowSettingGym({
            expected: false,
            globalSetting: true,
            projectSetting: false,
        });
        running.add(gym);

        submit(gym, "Check whether workflows are available here.");
        const disabled = await gym.terminal.waitForText("WORKFLOWS_DISABLED", 30_000);
        expect(disabled.text).not.toContain("WORKFLOWS_ENABLED");

        gym.terminal.type("/work");
        const command = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("/work") && snapshot.scroll.atBottom,
            "the partial workflow command without a workflow suggestion",
            30_000,
        );
        expect(command.text).not.toContain("Open the live workflow monitor");
    }, 120_000);
});

async function createWorkflowSettingGym(options: {
    expected: boolean;
    globalSetting: boolean;
    projectSetting: boolean;
}): Promise<Gym> {
    return await createGym({
        files: {
            "rig.toml": `[features]\nworkflows = ${String(options.projectSetting)}\n`,
        },
        homeFiles: {
            ".rig/config.toml": `[features]\nworkflows = ${String(options.globalSetting)}\n`,
        },
        inference(request) {
            if (request.options.sessionId?.endsWith(":title")) {
                return { content: [{ text: "Workflow setting", type: "text" }] };
            }
            const names = request.context.tools?.map((tool) => tool.name) ?? [];
            for (const tool of WORKFLOW_TOOLS) {
                expect(names.includes(tool)).toBe(options.expected);
            }
            expect(names).toContain("spawn_agent");
            return {
                content: [
                    {
                        text: options.expected ? "WORKFLOWS_ENABLED" : "WORKFLOWS_DISABLED",
                        type: "text",
                    },
                ],
            };
        },
    });
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
