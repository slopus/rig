import { describe, expect, it } from "vitest";

import { encodeWirePacket } from "./encodeWirePacket.js";
import { WirePacketDecoder } from "./WirePacketDecoder.js";
import { WirePacketType } from "./WirePacket.js";

describe("WirePacketDecoder", () => {
    it("decodes compressed packets split at every byte", () => {
        const source = Buffer.from("terminal-state-".repeat(1_000));
        const encoded = encodeWirePacket({
            payload: source,
            sequence: source.length,
            type: WirePacketType.Output,
        }).data;
        const decoder = new WirePacketDecoder();
        const packets = [];
        for (const byte of encoded) packets.push(...decoder.push(Uint8Array.of(byte)));
        expect(packets).toHaveLength(1);
        expect(Buffer.from(packets[0]!.payload)).toEqual(source);
        expect(packets[0]).toMatchObject({ sequence: source.length, type: WirePacketType.Output });
    });

    it("rejects oversized and malformed frames before allocation", () => {
        const encoded = encodeWirePacket({
            payload: Buffer.from("hello"),
            sequence: 5,
            type: WirePacketType.Output,
        }).data;
        const malformed = Buffer.from(encoded);
        malformed.writeUInt16BE(0, 0);
        expect(() => new WirePacketDecoder().push(malformed)).toThrow("Invalid wire magic");

        const oversized = Buffer.from(encoded.subarray(0, 20));
        oversized.writeUInt32BE(10_000, 16);
        expect(() => new WirePacketDecoder(100).push(oversized)).toThrow("too large");

        const unknownFlags = Buffer.from(encoded);
        unknownFlags.writeUInt8(0x80, 4);
        expect(() => new WirePacketDecoder().push(unknownFlags)).toThrow("flags");

        const empty = encodeWirePacket({
            payload: Buffer.alloc(0),
            sequence: 0,
            type: WirePacketType.OutputAck,
        }).data;
        const controlFlood = Buffer.concat(Array.from({ length: 10_000 }, () => empty));
        expect(() => new WirePacketDecoder(1_024).push(controlFlood)).toThrow(
            "buffer is too large",
        );
    });
});
