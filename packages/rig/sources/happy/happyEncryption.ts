import { createCipheriv, createDecipheriv, randomBytes as nodeRandomBytes } from "node:crypto";

import tweetnacl from "tweetnacl";

import type { HappyEncryptionVariant } from "./types.js";

type RandomBytes = (size: number) => Uint8Array;

export function encryptHappyPayload(
    key: Uint8Array,
    variant: HappyEncryptionVariant,
    value: unknown,
    randomBytes: RandomBytes = (size) => new Uint8Array(nodeRandomBytes(size)),
): Uint8Array {
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    if (variant === "legacy") {
        const nonce = randomBytes(tweetnacl.secretbox.nonceLength);
        const ciphertext = tweetnacl.secretbox(plaintext, nonce, key);
        return concatenate(nonce, ciphertext);
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return concatenate(new Uint8Array([0]), nonce, ciphertext, cipher.getAuthTag());
}

export function decryptHappyPayload(
    key: Uint8Array,
    variant: HappyEncryptionVariant,
    bundle: Uint8Array,
): unknown | undefined {
    try {
        let plaintext: Uint8Array | undefined;
        if (variant === "legacy") {
            if (
                bundle.length <
                tweetnacl.secretbox.nonceLength + tweetnacl.secretbox.overheadLength
            ) {
                return undefined;
            }
            plaintext =
                tweetnacl.secretbox.open(
                    bundle.slice(tweetnacl.secretbox.nonceLength),
                    bundle.slice(0, tweetnacl.secretbox.nonceLength),
                    key,
                ) ?? undefined;
        } else {
            if (bundle[0] !== 0 || bundle.length < 29) return undefined;
            const decipher = createDecipheriv("aes-256-gcm", key, bundle.slice(1, 13));
            decipher.setAuthTag(bundle.slice(-16));
            plaintext = new Uint8Array(
                Buffer.concat([decipher.update(bundle.slice(13, -16)), decipher.final()]),
            );
        }
        if (plaintext === undefined) return undefined;
        return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    } catch {
        return undefined;
    }
}

export function wrapHappyDataKey(
    dataKey: Uint8Array,
    recipientPublicKey: Uint8Array,
    randomBytes: RandomBytes = (size) => new Uint8Array(nodeRandomBytes(size)),
): Uint8Array {
    const ephemeral = tweetnacl.box.keyPair.fromSecretKey(
        randomBytes(tweetnacl.box.secretKeyLength),
    );
    const nonce = randomBytes(tweetnacl.box.nonceLength);
    const encrypted = tweetnacl.box(dataKey, nonce, recipientPublicKey, ephemeral.secretKey);
    return concatenate(new Uint8Array([0]), ephemeral.publicKey, nonce, encrypted);
}

export function decryptHappyAuthBundle(
    bundle: Uint8Array,
    recipientSecretKey: Uint8Array,
): Uint8Array | undefined {
    if (bundle.length < tweetnacl.box.publicKeyLength + tweetnacl.box.nonceLength) return undefined;
    return (
        tweetnacl.box.open(
            bundle.slice(tweetnacl.box.publicKeyLength + tweetnacl.box.nonceLength),
            bundle.slice(
                tweetnacl.box.publicKeyLength,
                tweetnacl.box.publicKeyLength + tweetnacl.box.nonceLength,
            ),
            bundle.slice(0, tweetnacl.box.publicKeyLength),
            recipientSecretKey,
        ) ?? undefined
    );
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
    const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}
