import type { AgentContext } from "../agent/index.js";
import { errorToMessage } from "../errorToMessage.js";
import type {
    WorkflowAgentCacheEntry,
    WorkflowCheckpoint,
    WorkflowExecutionResult,
} from "./WorkflowContext.js";
import { parseStructuredWorkflowResult } from "./parseStructuredWorkflowResult.js";
import { serializeWorkflowValue } from "./serializeWorkflowValue.js";
import { runMontyWithExternals } from "./runMontyWithExternals.js";
import { fromMontyValue } from "./fromMontyValue.js";

const MAX_WORKFLOW_AGENTS = 1_000;
const MAX_WORKFLOW_BATCH_ITEMS = 4_096;

interface WorkflowAgentOptions {
    label?: string;
    model?: string;
    schema?: Record<string, unknown>;
}

interface WorkflowAgentRequest extends WorkflowAgentOptions {
    prompt: string;
}

interface WorkflowRunnerOptions {
    agentContext: AgentContext;
    args: unknown;
    onAgentCall(): void;
    onAgentResult?(index: number, result: WorkflowAgentCacheEntry): void;
    onCheckpoint?(checkpoint: WorkflowCheckpoint): void;
    onLog(message: string): void;
    parentToolCallId?: string;
    resumeAgentCalls: readonly (WorkflowAgentCacheEntry | undefined)[];
    resumeCheckpoint?: WorkflowCheckpoint;
    signal: AbortSignal;
    workflowRunId: string;
}

export class WorkflowScriptRunner {
    readonly #agentContext: AgentContext;
    readonly #agentCalls: (WorkflowAgentCacheEntry | undefined)[];
    readonly #args: unknown;
    readonly #onAgentCall: () => void;
    readonly #onAgentResult: ((index: number, result: WorkflowAgentCacheEntry) => void) | undefined;
    readonly #onCheckpoint: ((checkpoint: WorkflowCheckpoint) => void) | undefined;
    readonly #onLog: (message: string) => void;
    readonly #parentToolCallId: string | undefined;
    readonly #resumeAgentCalls: readonly (WorkflowAgentCacheEntry | undefined)[];
    readonly #resumeCheckpoint: WorkflowCheckpoint | undefined;
    readonly #signal: AbortSignal;
    readonly #workflowRunId: string;

    #nextAgentCallIndex = 0;
    #phase = "Workflow";

    constructor(options: WorkflowRunnerOptions) {
        this.#agentContext = options.agentContext;
        this.#agentCalls =
            options.resumeCheckpoint === undefined ? [] : [...options.resumeAgentCalls];
        this.#args = options.args;
        this.#onAgentCall = options.onAgentCall;
        this.#onAgentResult = options.onAgentResult;
        this.#onCheckpoint = options.onCheckpoint;
        this.#onLog = options.onLog;
        this.#parentToolCallId = options.parentToolCallId;
        this.#resumeAgentCalls = options.resumeAgentCalls;
        this.#resumeCheckpoint = options.resumeCheckpoint;
        this.#signal = options.signal;
        this.#workflowRunId = options.workflowRunId;
        if (options.resumeCheckpoint !== undefined) {
            this.#nextAgentCallIndex = options.resumeCheckpoint.nextAgentCallIndex;
            this.#phase = options.resumeCheckpoint.phase;
        }
    }

    async run(script: string): Promise<WorkflowExecutionResult> {
        const output = await runMontyWithExternals({
            code: script,
            externalFunctions: {
                agent: (prompt, options) =>
                    this.#runAgent(fromMontyValue(prompt), fromMontyValue(options)),
                log: (message) => this.#log(fromMontyValue(message)),
                parallel: (requests) => this.#runParallel(fromMontyValue(requests)),
                phase: (title) => this.#setPhase(fromMontyValue(title)),
                pipeline: (items, stages) =>
                    this.#runPipeline(fromMontyValue(items), fromMontyValue(stages)),
            },
            inputNames: ["args"],
            inputs: { args: this.#args },
            limits: {
                maxAllocations: 1_000_000,
                maxDurationSecs: 30,
                maxMemory: 32 * 1024 * 1024,
                maxRecursionDepth: 200,
            },
            onPrint: (text) => this.#onLog(text.trimEnd()),
            onSnapshot: (snapshot) =>
                this.#onCheckpoint?.({
                    nextAgentCallIndex: this.#nextAgentCallIndex,
                    phase: this.#phase,
                    snapshot,
                }),
            signal: this.#signal,
            scriptName: "workflow.py",
            ...(this.#resumeCheckpoint === undefined
                ? {}
                : { snapshot: this.#resumeCheckpoint.snapshot }),
        });
        return { agentCalls: [...this.#agentCalls], output: fromMontyValue(output) };
    }

    async #runAgent(
        promptValue: unknown,
        optionsValue: unknown,
        reservedCallIndex?: number,
    ): Promise<unknown> {
        if (this.#signal.aborted) throw new Error("The workflow was stopped.");
        if (typeof promptValue !== "string" || promptValue.trim().length === 0) {
            throw new Error("agent() requires a non-empty prompt string.");
        }
        const options = this.#parseOptions(optionsValue);
        const prompt =
            options.schema === undefined
                ? promptValue
                : [
                      promptValue,
                      "",
                      "Return only JSON matching this JSON Schema:",
                      JSON.stringify(options.schema),
                  ].join("\n");
        const signature = JSON.stringify({ options, prompt: promptValue });
        const cacheIndex = reservedCallIndex ?? this.#reserveAgentCallIndex();
        const cached = this.#resumeAgentCalls[cacheIndex];
        if (cached?.signature === signature) {
            this.#agentCalls[cacheIndex] = cached;
            this.#onAgentResult?.(cacheIndex, cached);
            this.#onLog(`Reused ${options.label ?? this.#phase} from the previous run.`);
            return cached.output;
        }
        this.#onAgentCall();
        const description = options.label ?? this.#phase;
        const taskName = `workflow_${this.#workflowRunId}_${cacheIndex + 1}`;
        const result = await this.#requireSubagents().spawn(
            {
                description,
                ...(this.#parentToolCallId === undefined
                    ? {}
                    : { parentToolCallId: this.#parentToolCallId }),
                ...(options.model === undefined ? {} : { modelId: options.model }),
                prompt,
                taskName,
                waitForSlot: true,
            },
            this.#signal,
        );
        if (result.status !== "completed") throw new Error(result.output);
        const output =
            options.schema === undefined
                ? result.output
                : parseStructuredWorkflowResult(result.output, options.schema);
        const cacheEntry = { output, signature };
        this.#agentCalls[cacheIndex] = cacheEntry;
        this.#onAgentResult?.(cacheIndex, cacheEntry);
        return output;
    }

    async #runParallel(requestsValue: unknown): Promise<unknown[]> {
        const requests = this.#parseRequests(requestsValue, "parallel");
        const callIndices = this.#reserveAgentCallIndices(requests.length);
        return Promise.all(
            requests.map(async (request, index) => {
                try {
                    return await this.#runAgent(request.prompt, request, callIndices[index]!);
                } catch (error) {
                    this.#onLog(
                        `${request.label ?? "Workflow agent"} failed: ${errorToMessage(error)}`,
                    );
                    return null;
                }
            }),
        );
    }

    async #runPipeline(itemsValue: unknown, stagesValue: unknown): Promise<unknown[]> {
        if (!Array.isArray(itemsValue)) throw new Error("pipeline() requires a list of items.");
        const stages = this.#parseRequests(stagesValue, "pipeline");
        if (itemsValue.length > MAX_WORKFLOW_BATCH_ITEMS) {
            throw new Error(`pipeline() accepts at most ${MAX_WORKFLOW_BATCH_ITEMS} items.`);
        }
        const callIndices = this.#reserveAgentCallIndices(itemsValue.length * stages.length);
        return Promise.all(
            itemsValue.map(async (item, index) => {
                let result: unknown = item;
                try {
                    for (const [stageIndex, stage] of stages.entries()) {
                        const prompt = [
                            stage.prompt,
                            "",
                            `Original item (${index + 1}/${itemsValue.length}):`,
                            serializeWorkflowValue(item),
                            "",
                            "Previous stage result:",
                            serializeWorkflowValue(result),
                        ].join("\n");
                        result = await this.#runAgent(
                            prompt,
                            stage,
                            callIndices[index * stages.length + stageIndex]!,
                        );
                    }
                    return result;
                } catch (error) {
                    this.#onLog(`Pipeline item ${index + 1} failed: ${errorToMessage(error)}`);
                    return null;
                }
            }),
        );
    }

    #log(messageValue: unknown): null {
        if (typeof messageValue !== "string") throw new Error("log() requires a string.");
        this.#onLog(messageValue);
        return null;
    }

    #parseOptions(value: unknown): WorkflowAgentOptions {
        if (value === undefined || value === null) return {};
        if (typeof value !== "object" || Array.isArray(value)) {
            throw new Error("Agent options must be a dictionary.");
        }
        const candidate = value as Record<string, unknown>;
        const options: WorkflowAgentOptions = {};
        if (candidate.label !== undefined) {
            if (typeof candidate.label !== "string")
                throw new Error("Agent label must be a string.");
            options.label = candidate.label;
        }
        if (candidate.model !== undefined) {
            if (typeof candidate.model !== "string" || candidate.model.trim().length === 0) {
                throw new Error("Agent model must be a non-empty model name.");
            }
            options.model = candidate.model.trim();
        }
        if (candidate.schema !== undefined) {
            if (
                typeof candidate.schema !== "object" ||
                candidate.schema === null ||
                Array.isArray(candidate.schema)
            ) {
                throw new Error("Agent schema must be a JSON Schema dictionary.");
            }
            options.schema = candidate.schema as Record<string, unknown>;
        }
        return options;
    }

    #parseRequests(value: unknown, functionName: string): WorkflowAgentRequest[] {
        if (!Array.isArray(value)) throw new Error(`${functionName}() requires a list.`);
        if (value.length > MAX_WORKFLOW_BATCH_ITEMS) {
            throw new Error(`${functionName}() accepts at most ${MAX_WORKFLOW_BATCH_ITEMS} items.`);
        }
        return value.map((item, index) => {
            if (typeof item === "string") return { prompt: item };
            if (typeof item !== "object" || item === null || Array.isArray(item)) {
                throw new Error(
                    `${functionName}() item ${index + 1} must be a prompt or dictionary.`,
                );
            }
            const candidate = item as Record<string, unknown>;
            if (typeof candidate.prompt !== "string" || candidate.prompt.trim().length === 0) {
                throw new Error(`${functionName}() item ${index + 1} needs a prompt.`);
            }
            return { prompt: candidate.prompt, ...this.#parseOptions(candidate) };
        });
    }

    #requireSubagents() {
        const subagents = this.#agentContext.subagents;
        if (subagents === undefined || !subagents.canSpawn) {
            throw new Error("This session cannot start workflow agents.");
        }
        return subagents;
    }

    #reserveAgentCallIndices(count: number): number[] {
        if (this.#nextAgentCallIndex + count > MAX_WORKFLOW_AGENTS) {
            throw new Error(`Workflows are limited to ${MAX_WORKFLOW_AGENTS} agent calls.`);
        }
        const first = this.#nextAgentCallIndex;
        this.#nextAgentCallIndex += count;
        return Array.from({ length: count }, (_, index) => first + index);
    }

    #reserveAgentCallIndex(): number {
        return this.#reserveAgentCallIndices(1)[0]!;
    }

    #setPhase(titleValue: unknown): null {
        if (typeof titleValue !== "string" || titleValue.trim().length === 0) {
            throw new Error("phase() requires a non-empty title.");
        }
        this.#phase = titleValue.trim();
        this.#onLog(`Phase: ${this.#phase}`);
        return null;
    }
}
