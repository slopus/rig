import { createHash } from "node:crypto";

const UUID_URL_NAMESPACE = "6ba7b8119dad11d180b400c04fd430c8";

export function createClaudeSessionId(agentId: string): string {
    const namespace = Buffer.from(UUID_URL_NAMESPACE, "hex");
    const digest = createHash("sha1")
        .update(namespace)
        .update(`https://rig.dev/claude-session/${agentId}`)
        .digest();
    const bytes = Buffer.from(digest.subarray(0, 16));

    bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
    bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
