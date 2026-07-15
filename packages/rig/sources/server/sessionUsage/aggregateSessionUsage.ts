import type { SessionEvent } from "../../protocol/index.js";
import { addUsage } from "./addUsage.js";
import {
    EARLIER_USAGE_LABEL,
    MODEL_UNAVAILABLE_LABEL,
    type AttributedSessionUsageGroup,
    type EarlierSessionUsageGroup,
    type SessionContextUsage,
    type SessionUsageGroup,
    type SessionUsageMetadata,
    type SessionUsageSummary,
} from "./types.js";
import { zeroUsage } from "./zeroUsage.js";

interface ActiveModel {
    modelId: string;
    providerId: string;
    requestedModelId: string;
    responseModel?: string;
}

export function aggregateSessionUsage(
    events: readonly SessionEvent[],
    metadata: SessionUsageMetadata,
): SessionUsageSummary {
    if (metadata.type === "subagent") return { groups: [] };

    let groups: SessionUsageGroup[] = [];
    let attributedGroupIndexes = new Map<string, number>();
    let earlierGroupIndex: number | undefined;
    let activeModel: ActiveModel | undefined;
    let currentContext: SessionContextUsage | undefined;

    for (const event of events) {
        if (event.type === "session_reset") {
            groups = [];
            attributedGroupIndexes = new Map();
            earlierGroupIndex = undefined;
            activeModel = {
                modelId: event.data.snapshot.modelId,
                providerId: event.data.snapshot.providerId,
                requestedModelId: event.data.snapshot.modelId,
            };
            currentContext = undefined;
            continue;
        }

        if (event.type === "session_created") {
            activeModel = {
                modelId: event.data.session.modelId,
                providerId: event.data.session.providerId,
                requestedModelId: event.data.session.modelId,
            };
            continue;
        }

        if (event.type === "model_changed" || event.type === "session_rewound") {
            activeModel = {
                modelId: event.data.snapshot.modelId,
                providerId: event.data.snapshot.providerId,
                requestedModelId: event.data.snapshot.modelId,
            };
            currentContext = undefined;
            continue;
        }

        if (
            event.type === "agent_event" &&
            event.data.event.type === "context_compacted" &&
            activeModel !== undefined
        ) {
            currentContext = {
                ...activeModel,
                approximate: true,
                totalTokens: event.data.event.estimatedTokensAfter,
            };
            continue;
        }

        if (event.type !== "agent_message") continue;
        const message = event.data.message;
        if (message.role !== "agent" || message.usage === undefined) continue;

        const hasCompleteAttribution =
            message.providerId !== undefined &&
            message.providerId.trim().length > 0 &&
            message.requestedModelId !== undefined &&
            message.requestedModelId.trim().length > 0;
        if (!hasCompleteAttribution) {
            if (earlierGroupIndex === undefined) {
                const earlierGroup: EarlierSessionUsageGroup = {
                    kind: "earlier",
                    label: EARLIER_USAGE_LABEL,
                    modelId: null,
                    modelLabel: MODEL_UNAVAILABLE_LABEL,
                    providerId: null,
                    requestedModelId: null,
                    usage: zeroUsage(),
                };
                earlierGroupIndex = groups.length;
                groups.push(earlierGroup);
            }
            const earlierGroup = groups[earlierGroupIndex] as EarlierSessionUsageGroup;
            groups[earlierGroupIndex] = {
                ...earlierGroup,
                usage: addUsage(earlierGroup.usage, message.usage),
            };
            currentContext = undefined;
            continue;
        }

        const providerId = message.providerId as string;
        const requestedModelId = message.requestedModelId as string;
        const modelId = message.responseModel ?? requestedModelId;
        const groupKey = JSON.stringify([providerId, requestedModelId, message.responseModel]);
        let groupIndex = attributedGroupIndexes.get(groupKey);
        if (groupIndex === undefined) {
            const group: AttributedSessionUsageGroup = {
                kind: "attributed",
                modelId,
                providerId,
                requestedModelId,
                ...(message.responseModel === undefined
                    ? {}
                    : { responseModel: message.responseModel }),
                usage: zeroUsage(),
            };
            groupIndex = groups.length;
            attributedGroupIndexes.set(groupKey, groupIndex);
            groups.push(group);
        }
        const group = groups[groupIndex] as AttributedSessionUsageGroup;
        groups[groupIndex] = { ...group, usage: addUsage(group.usage, message.usage) };
        activeModel = {
            modelId,
            providerId,
            requestedModelId,
            ...(message.responseModel === undefined
                ? {}
                : { responseModel: message.responseModel }),
        };
        currentContext = {
            ...activeModel,
            approximate: false,
            totalTokens: message.usage.totalTokens,
        };
    }

    return {
        ...(currentContext === undefined ? {} : { currentContext }),
        groups,
    };
}
