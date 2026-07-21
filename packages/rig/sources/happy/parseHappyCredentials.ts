import { z } from "zod";

import type { HappyCredentials, HappyStoredCredentials } from "./types.js";

const storedCredentialsSchema = z
    .object({
        encryption: z
            .object({
                machineKey: z.string(),
                publicKey: z.string(),
            })
            .optional(),
        secret: z.string().optional(),
        token: z.string().min(1),
    })
    .superRefine((value, context) => {
        if ((value.secret === undefined) === (value.encryption === undefined)) {
            context.addIssue({
                code: "custom",
                message: "Happy credentials must contain exactly one encryption format.",
            });
        }
    });

export function parseHappyCredentials(value: unknown): {
    credentials: HappyCredentials;
    stored: HappyStoredCredentials;
} {
    const parsed = storedCredentialsSchema.parse(value);
    if (parsed.secret !== undefined) {
        const secret = decodeKey(parsed.secret, "secret");
        return {
            credentials: { encryption: { secret, type: "legacy" }, token: parsed.token },
            stored: { secret: parsed.secret, token: parsed.token },
        };
    }
    const encryption = parsed.encryption!;
    const machineKey = decodeKey(encryption.machineKey, "machineKey");
    const publicKey = decodeKey(encryption.publicKey, "publicKey");
    return {
        credentials: {
            encryption: { machineKey, publicKey, type: "dataKey" },
            token: parsed.token,
        },
        stored: {
            encryption: { machineKey: encryption.machineKey, publicKey: encryption.publicKey },
            token: parsed.token,
        },
    };
}

function decodeKey(value: string, name: string): Uint8Array {
    const decoded = new Uint8Array(Buffer.from(value, "base64"));
    if (decoded.length !== 32 || Buffer.from(decoded).toString("base64") !== value) {
        throw new Error(`Happy ${name} must be a 32-byte base64 value.`);
    }
    return decoded;
}
