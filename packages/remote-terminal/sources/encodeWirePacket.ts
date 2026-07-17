import { deflateRawSync } from "node:zlib";

import { WIRE_HEADER_BYTES, WIRE_MAGIC, WIRE_VERSION, type WirePacket } from "./WirePacket.js";

const COMPRESSED = 1;

export function encodeWirePacket(packet: WirePacket): {
    compressed: boolean;
    data: Buffer;
    payloadBytes: number;
} {
    if (!Number.isSafeInteger(packet.sequence) || packet.sequence < 0) {
        throw new Error("A wire sequence must be a non-negative safe integer.");
    }
    if (!Number.isInteger(packet.type) || packet.type < 1 || packet.type > 18) {
        throw new Error("Unknown remote terminal packet type.");
    }
    const source = Buffer.from(packet.payload);
    const compressed = source.length >= 512 ? deflateRawSync(source) : source;
    const useCompression = compressed.length + 16 < source.length;
    const payload = useCompression ? compressed : source;
    const frame = Buffer.allocUnsafe(WIRE_HEADER_BYTES + payload.length);
    frame.writeUInt16BE(WIRE_MAGIC, 0);
    frame.writeUInt8(WIRE_VERSION, 2);
    frame.writeUInt8(packet.type, 3);
    frame.writeUInt8(useCompression ? COMPRESSED : 0, 4);
    frame.fill(0, 5, 8);
    frame.writeBigUInt64BE(BigInt(packet.sequence), 8);
    frame.writeUInt32BE(payload.length, 16);
    payload.copy(frame, WIRE_HEADER_BYTES);
    return { compressed: useCompression, data: frame, payloadBytes: source.length };
}
