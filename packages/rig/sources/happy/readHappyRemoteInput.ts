import type { HappyRemoteInput } from "./types.js";

export function readHappyRemoteInput(value: unknown): HappyRemoteInput | undefined {
    if (!isRecord(value)) return undefined;
    const outerMeta = isRecord(value.meta) ? value.meta : undefined;
    if (outerMeta?.sentFrom === "rig") return { kind: "echo" };

    if (value.role === "user" && isRecord(value.content)) {
        if (value.content.type === "text" && typeof value.content.text === "string") {
            return {
                kind: "text",
                meta: readSelection(outerMeta),
                text: value.content.text,
            };
        }
    }

    if (value.role !== "session" || !isRecord(value.content)) return undefined;
    const envelope =
        value.content.type === "session" && isRecord(value.content.data)
            ? value.content.data
            : value.content;
    if (envelope.role !== "user" || !isRecord(envelope.ev)) return undefined;
    if (
        envelope.ev.t === "file" &&
        typeof envelope.ev.ref === "string" &&
        typeof envelope.ev.name === "string" &&
        typeof envelope.ev.size === "number"
    ) {
        return {
            kind: "attachment",
            ...(typeof envelope.ev.mimeType === "string" ? { mimeType: envelope.ev.mimeType } : {}),
            name: envelope.ev.name,
            ref: envelope.ev.ref,
            size: envelope.ev.size,
        };
    }
    if (envelope.ev.t === "text" && typeof envelope.ev.text === "string") {
        const envelopeMeta = isRecord(envelope.meta) ? envelope.meta : outerMeta;
        return { kind: "text", meta: readSelection(envelopeMeta), text: envelope.ev.text };
    }
    return undefined;
}

function readSelection(meta: Record<string, unknown> | undefined) {
    if (meta === undefined) return {};
    const effort = firstString(meta.effort, meta.reasoning, meta.thinkingLevel);
    const permissionMode = firstString(meta.permissionMode);
    const providerId = firstString(meta.modelProviderId, meta.providerId);
    return {
        ...(effort === undefined ? {} : { effort }),
        ...(typeof meta.model === "string" ? { modelId: meta.model } : {}),
        ...(permissionMode === undefined ? {} : { permissionMode }),
        ...(providerId === undefined ? {} : { providerId }),
    };
}

function firstString(...values: readonly unknown[]): string | undefined {
    return values.find((value): value is string => typeof value === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
