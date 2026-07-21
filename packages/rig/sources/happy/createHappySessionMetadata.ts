import { hostname, homedir, platform, release } from "node:os";

import type { ModelCatalog, ProtocolSession, SubagentSummary } from "../protocol/index.js";
import { readPackageVersion } from "../readPackageVersion.js";
import type {
    HappyConnectionConfiguration,
    HappyProviderDescriptor,
    HappySessionMetadata,
} from "./types.js";
import { HAPPY_PERMISSION_MODES } from "./happyPermissionModes.js";
import { HAPPY_SESSION_RPC_METHODS } from "./handleHappySessionRpc.js";

export function createHappySessionMetadata(options: {
    configuration: HappyConnectionConfiguration;
    modelCatalog?: ModelCatalog;
    session: ProtocolSession;
    subagents: readonly SubagentSummary[];
    summaryUpdatedAt: number;
}): HappySessionMetadata {
    const { configuration, modelCatalog, session, subagents, summaryUpdatedAt } = options;
    const providerModels =
        modelCatalog !== undefined && modelCatalog.providers.length > 0
            ? modelCatalog.providers.flatMap((provider) =>
                  provider.models.map((model) => ({
                      model,
                      providerId: provider.providerId,
                      serviceTiers: provider.serviceTiers ?? [],
                  })),
              )
            : session.models.map((model) => ({
                  model,
                  providerId: session.providerId,
                  serviceTiers: [],
              }));
    const selectedModel = providerModels.find(
        ({ model, providerId }) =>
            model.id === session.modelId && providerId === session.providerId,
    )?.model;
    const providers = uniqueProviderIds(
        modelCatalog !== undefined && modelCatalog.providers.length > 0
            ? modelCatalog.providers.map((provider) => provider.providerId)
            : [session.providerId],
    ).map(describeProvider);
    const currentProvider = describeProvider(session.providerId);
    const title = session.title ?? "Rig session";
    const runningSubagents = subagents.filter((subagent) => subagent.status === "running").length;
    const queuedSubagents = subagents.filter((subagent) => subagent.status === "queued").length;
    const workflows = session.workflows ?? [];
    const runningWorkflows = workflows.filter((workflow) => workflow.status === "running").length;
    const processes = session.backgroundProcesses ?? [];
    const tasks = session.tasks ?? [];

    return {
        activity: {
            processes: { running: processes.length },
            subagents: {
                queued: queuedSubagents,
                running: runningSubagents,
                total: subagents.length,
            },
            tasks: {
                completed: tasks.filter((task) => task.status === "completed").length,
                inProgress: tasks.filter((task) => task.status === "in_progress").length,
                pending: tasks.filter((task) => task.status === "pending").length,
                total: tasks.length,
            },
            workflows: { running: runningWorkflows, total: workflows.length },
        },
        capabilities: {
            abort: true,
            attachments: {
                enabled: true,
                maxBytes: 10 * 1024 * 1024,
                mediaTypes: ["image/*"],
            },
            files: {
                browse: true,
                read: true,
                search: true,
                write: session.permissionMode !== "read_only",
            },
            modelSelection: !session.modelLocked,
            permissionModeSelection: true,
            reasoningSelection: true,
            resume: false,
            rpcMethods: [...HAPPY_SESSION_RPC_METHODS],
            shell: true,
            steering: true,
        },
        client: { id: "rig", name: "Rig", version: readPackageVersion() },
        currentModelCode: session.modelId,
        currentModelProviderId: session.providerId,
        currentOperatingModeCode: session.permissionMode,
        ...(session.effort === undefined
            ? {}
            : {
                  currentThoughtLevelCode: session.effort,
              }),
        flavor: session.providerId,
        happyHomeDir: configuration.happyHome,
        happyLibDir: configuration.happyHome,
        happyToolsDir: configuration.happyHome,
        homeDir: homedir(),
        host: hostname(),
        hostPid: process.pid,
        ...(configuration.machineId === undefined ? {} : { machineId: configuration.machineId }),
        mcpServers: session.mcpServers.map((server) => ({
            name: server.name,
            status: server.status,
        })),
        models: providerModels.map(({ model, providerId, serviceTiers }) => {
            const provider = describeProvider(providerId);
            return {
                code: model.id,
                ...(model.contextWindow === undefined
                    ? {}
                    : { contextWindow: model.contextWindow }),
                defaultThinkingLevel: model.defaultThinkingLevel,
                id: model.id,
                name: model.name,
                provider,
                providerId,
                providerKind: provider.kind,
                providerName: provider.name,
                serviceTiers: [...(serviceTiers ?? [])],
                thinkingLevels: [...model.thinkingLevels],
                value: model.name,
            };
        }),
        model: { id: session.modelId, providerId: session.providerId },
        name: title,
        operatingModes: HAPPY_PERMISSION_MODES.map((mode) => ({ ...mode })),
        os: `${platform()} ${release()}`,
        path: session.cwd,
        permissionMode: session.permissionMode,
        provider: currentProvider,
        providers,
        reasoning: {
            current: session.effort ?? null,
            levels: [...(selectedModel?.thinkingLevels ?? [])],
        },
        rigMetadataVersion: 1,
        session: {
            modelLocked: session.modelLocked,
            permissionMode: session.permissionMode,
            ...(session.serviceTier === undefined ? {} : { serviceTier: session.serviceTier }),
            status: session.status,
        },
        skills: session.skills?.map((skill) => skill.name) ?? [],
        startedBy: "daemon",
        startedFromDaemon: true,
        summary: { text: title, updatedAt: summaryUpdatedAt },
        thoughtLevels:
            selectedModel?.thinkingLevels.map((level) => ({ code: level, value: level })) ?? [],
        tools: [...session.snapshot.tools],
    };
}

function describeProvider(providerId: string): HappyProviderDescriptor {
    const known: Readonly<Record<string, Omit<HappyProviderDescriptor, "id">>> = {
        claude: { kind: "claude", name: "Anthropic Claude" },
        codex: { kind: "codex", name: "OpenAI Codex" },
        grok: { kind: "grok", name: "xAI Grok" },
        kimi: { kind: "kimi", name: "Moonshot Kimi" },
    };
    return {
        id: providerId,
        ...(known[providerId] ?? {
            kind: "custom",
            name: providerId
                .replaceAll(/[_-]+/gu, " ")
                .replaceAll(/\b\w/gu, (character) => character.toUpperCase()),
        }),
    };
}

function uniqueProviderIds(providerIds: readonly string[]): readonly string[] {
    return [...new Set(providerIds)];
}
