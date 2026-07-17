import { inflateRawSync } from "node:zlib";

import {
    WIRE_HEADER_BYTES,
    WIRE_MAGIC,
    WIRE_VERSION,
    type WirePacket,
    WirePacketType,
} from "./WirePacket.js";

const COMPRESSED = 1;
const KNOWN_FLAGS = COMPRESSED;

/** Incremental bounded decoder. It never recopies the unconsumed byte stream. */
export class WirePacketDecoder {
    #bufferedBytes = 0;
    readonly #chunks: Buffer[] = [];
    readonly #maxFrameBytes: number;
    readonly #maxPacketsPerPush: number;

    constructor(maxFrameBytes = 32 * 1024 * 1024, maxPacketsPerPush = 4_096) {
        if (
            !Number.isSafeInteger(maxFrameBytes) ||
            maxFrameBytes < 1 ||
            maxFrameBytes > 64 * 1024 * 1024
        ) {
            throw new Error("Invalid maximum remote terminal frame size.");
        }
        if (
            !Number.isSafeInteger(maxPacketsPerPush) ||
            maxPacketsPerPush < 1 ||
            maxPacketsPerPush > 65_536
        ) {
            throw new Error("Invalid remote terminal packet batch limit.");
        }
        this.#maxFrameBytes = maxFrameBytes;
        this.#maxPacketsPerPush = maxPacketsPerPush;
    }

    push(data: Uint8Array): readonly WirePacket[] {
        if (data.length > 0) {
            this.#chunks.push(Buffer.from(data));
            this.#bufferedBytes += data.length;
        }
        if (this.#bufferedBytes > this.#maxFrameBytes + WIRE_HEADER_BYTES) {
            throw new Error("Remote terminal receive buffer is too large.");
        }
        const packets: WirePacket[] = [];
        while (this.#bufferedBytes >= WIRE_HEADER_BYTES) {
            if (packets.length >= this.#maxPacketsPerPush) {
                throw new Error("Too many remote terminal packets in one read.");
            }
            const header = this.#peek(WIRE_HEADER_BYTES);
            if (header.readUInt16BE(0) !== WIRE_MAGIC) throw new Error("Invalid wire magic.");
            if (header.readUInt8(2) !== WIRE_VERSION) {
                throw new Error("Unsupported remote terminal wire version.");
            }
            const type = header.readUInt8(3);
            if (type < WirePacketType.ClientHello || type > WirePacketType.ResizeApplied) {
                throw new Error("Unknown remote terminal packet type.");
            }
            const flags = header.readUInt8(4);
            if ((flags & ~KNOWN_FLAGS) !== 0)
                throw new Error("Unknown remote terminal packet flags.");
            if (header.readUIntBE(5, 3) !== 0)
                throw new Error("Nonzero reserved wire header bytes.");
            const length = header.readUInt32BE(16);
            if (length > this.#maxFrameBytes)
                throw new Error("Remote terminal frame is too large.");
            const frameLength = WIRE_HEADER_BYTES + length;
            if (this.#bufferedBytes < frameLength) break;
            this.#consume(WIRE_HEADER_BYTES);
            const encoded = this.#read(length);
            let payload: Buffer;
            try {
                payload =
                    flags & COMPRESSED
                        ? inflateRawSync(encoded, { maxOutputLength: this.#maxFrameBytes })
                        : encoded;
            } catch (error) {
                throw new Error("Invalid compressed remote terminal frame.", { cause: error });
            }
            if (payload.length > this.#maxFrameBytes) {
                throw new Error("Inflated remote terminal frame is too large.");
            }
            const sequence = Number(header.readBigUInt64BE(8));
            if (!Number.isSafeInteger(sequence)) throw new Error("Wire sequence is too large.");
            packets.push({ payload, sequence, type: type as WirePacketType });
        }
        return packets;
    }

    #consume(length: number): void {
        let remaining = length;
        while (remaining > 0) {
            const first = this.#chunks[0]!;
            if (first.length <= remaining) {
                this.#chunks.shift();
                remaining -= first.length;
            } else {
                this.#chunks[0] = first.subarray(remaining);
                remaining = 0;
            }
        }
        this.#bufferedBytes -= length;
    }

    #peek(length: number): Buffer {
        const first = this.#chunks[0]!;
        if (first.length >= length) return first.subarray(0, length);
        const result = Buffer.allocUnsafe(length);
        let offset = 0;
        for (const chunk of this.#chunks) {
            const copied = Math.min(chunk.length, length - offset);
            chunk.copy(result, offset, 0, copied);
            offset += copied;
            if (offset === length) break;
        }
        return result;
    }

    #read(length: number): Buffer {
        if (length === 0) return Buffer.alloc(0);
        const first = this.#chunks[0]!;
        if (first.length === length) {
            this.#chunks.shift();
            this.#bufferedBytes -= length;
            return first;
        }
        if (first.length > length) {
            const result = first.subarray(0, length);
            this.#chunks[0] = first.subarray(length);
            this.#bufferedBytes -= length;
            return result;
        }
        const result = this.#peek(length);
        this.#consume(length);
        return result;
    }
}
