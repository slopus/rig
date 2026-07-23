import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_workflow_tool: SessionTool = {
    name: "Workflow",
    type: "local",
    description:
        'Run a deterministic multi-agent workflow in the background using sandboxed Python.\n\nProvide exactly one of `script` or `scriptPath`.\n\nOnly use this tool when the user explicitly asks for a workflow, multi-agent orchestration, or "ultracode". Workflows can spend substantially more tokens than a normal turn.\n\nThe Python script coordinates agents but has no direct filesystem, shell, environment, or network access. Those capabilities remain inside the subagents. The final Python expression becomes the consolidated workflow result. Do not use top-level return.\n\nAvailable Python globals:\n- args: the JSON value passed in this tool call, or None.\n- agent(prompt, options={}): run one subagent and return its final text. Options support label, model, and schema. Model is an available model ID; when omitted, the agent inherits the parent model. With schema, the agent must return matching JSON and agent() returns the parsed value.\n- parallel(requests): run requests concurrently and return results in input order. Each request is a prompt string or {"prompt": str, "label": str, "model": str, "schema": object}. Failed items become None.\n- pipeline(items, stages): process all items concurrently through sequential stages. Each stage is a prompt string or request dictionary. The original item and previous result are appended to every stage prompt. Failed items become None.\n- phase(title): group later agent calls under a human-readable phase.\n- log(message): include a progress note in the workflow run.\n- print(...): also records a progress note.\n\nExternal calls block until their host operation completes, even though subagents run asynchronously. The sandbox is checkpointed and unloaded at every external-call boundary, then freshly restored after the host operation finishes. Model inference time and earlier Python segments therefore do not consume the next segment\'s 30-second Monty execution budget. Call agent(), parallel(), and pipeline() directly; do not write await. Use parallel for a barrier and pipeline when every item can advance independently.\n\nExample:\nphase("Review")\nreviews = parallel([\n    {"prompt": "Review authentication for bugs.", "label": "Auth review"},\n    {"prompt": "Review storage for bugs.", "label": "Storage review"},\n])\nphase("Verify")\nverified = pipeline(\n    [review for review in reviews if review is not None],\n    [{"prompt": "Adversarially verify this finding.", "label": "Verify finding"}],\n)\n{"verified": [result for result in verified if result is not None]}\n\nRuns are capped at 1,000 total agents and queued at the session\'s subagent concurrency limit. The tool returns immediately with a task ID. A workflow notification arrives when the consolidated result is ready. When the user asks you to wait for the result, call the workflow wait tool once; it waits for any duration, so do not poll workflow status or end the turn. Pass resumeFromRunId to continue unchanged code from its latest checkpoint and reuse completed agent calls. If the code changed, completed calls from the unchanged prefix can still be reused safely.',
    parameters: Type.Object({
        args: Type.Optional(
            Type.Unknown({ description: "JSON input exposed to the script as args." }),
        ),
        description: Type.Optional(
            Type.String({
                description: "One sentence describing the workflow's outcome.",
                maxLength: 1000,
            }),
        ),
        name: Type.Optional(
            Type.String({ description: "Short lowercase workflow name.", maxLength: 128 }),
        ),
        resumeFromRunId: Type.Optional(
            Type.String({ description: "Prior workflow run to resume in this session." }),
        ),
        script: Type.Optional(
            Type.String({
                description: "Inline sandboxed Python workflow script.",
                maxLength: 524288,
            }),
        ),
        scriptPath: Type.Optional(
            Type.String({ description: "Path to a saved Python workflow script." }),
        ),
    }),
};

export const claude_workflow_tool_sonnet: SessionTool = {
    name: "Workflow",
    type: "local",
    description:
        'Run a deterministic multi-agent workflow in the background using sandboxed Python.\n\nProvide exactly one of `script` or `scriptPath`.\n\nOnly use this tool when the user explicitly asks for a workflow, multi-agent orchestration, or "ultracode". Workflows can spend substantially more tokens than a normal turn.\n\nThe Python script coordinates agents but has no direct filesystem, shell, environment, or network access. Those capabilities remain inside the subagents. The final Python expression becomes the consolidated workflow result. Do not use top-level return.\n\nAvailable Python globals:\n- args: the JSON value passed in this tool call, or None.\n- agent(prompt, options={}): run one subagent and return its final text. Options support label, model, and schema. Model is an available model ID; when omitted, the agent inherits the parent model. With schema, the agent must return matching JSON and agent() returns the parsed value.\n- parallel(requests): run requests concurrently and return results in input order. Each request is a prompt string or {"prompt": str, "label": str, "model": str, "schema": object}. Failed items become None.\n- pipeline(items, stages): process all items concurrently through sequential stages. Each stage is a prompt string or request dictionary. The original item and previous result are appended to every stage prompt. Failed items become None.\n- phase(title): group later agent calls under a human-readable phase.\n- log(message): include a progress note in the workflow run.\n- print(...): also records a progress note.\n\nExternal calls block until their host operation completes, even though subagents run asynchronously. The sandbox is checkpointed and unloaded at every external-call boundary, then freshly restored after the host operation finishes. Model inference time and earlier Python segments therefore do not consume the next segment\'s 30-second Monty execution budget. Call agent(), parallel(), and pipeline() directly; do not write await. Use parallel for a barrier and pipeline when every item can advance independently.\n\nExample:\nphase("Review")\nreviews = parallel([\n    {"prompt": "Review authentication for bugs.", "label": "Auth review"},\n    {"prompt": "Review storage for bugs.", "label": "Storage review"},\n])\nphase("Verify")\nverified = pipeline(\n    [review for review in reviews if review is not None],\n    [{"prompt": "Adversarially verify this finding.", "label": "Verify finding"}],\n)\n{"verified": [result for result in verified if result is not None]}\n\nRuns are capped at 1,000 total agents and queued at the session\'s subagent concurrency limit. The tool returns immediately with a task ID. A workflow notification arrives when the consolidated result is ready. When the user asks you to wait for the result, call the workflow wait tool once; it waits for any duration, so do not poll workflow status or end the turn. Pass resumeFromRunId to continue unchanged code from its latest checkpoint and reuse completed agent calls. If the code changed, completed calls from the unchanged prefix can still be reused safely.',
    parameters: Type.Object({
        args: Type.Optional(
            Type.Unknown({ description: "JSON input exposed to the script as args." }),
        ),
        description: Type.Optional(
            Type.String({
                description: "One sentence describing the workflow's outcome.",
                maxLength: 1000,
            }),
        ),
        name: Type.Optional(
            Type.String({ description: "Short lowercase workflow name.", maxLength: 128 }),
        ),
        resumeFromRunId: Type.Optional(
            Type.String({ description: "Prior workflow run to resume in this session." }),
        ),
        script: Type.Optional(
            Type.String({
                description: "Inline sandboxed Python workflow script.",
                maxLength: 524288,
            }),
        ),
        scriptPath: Type.Optional(
            Type.String({ description: "Path to a saved Python workflow script." }),
        ),
    }),
};
