export const WIRE_VERSION = 1;
export const WIRE_HEADER_BYTES = 20;
export const WIRE_MAGIC = 0x5254;

export const enum WirePacketType {
    ClientHello = 1,
    Welcome = 2,
    Output = 3,
    OutputAck = 4,
    Input = 5,
    InputAck = 6,
    Resize = 7,
    ResizeAck = 8,
    GridKeyframe = 9,
    GridPatch = 10,
    GridAck = 11,
    Mode = 12,
    Resync = 13,
    ScrollbackRequest = 14,
    ScrollbackPage = 15,
    Exit = 16,
    Error = 17,
    ResizeApplied = 18,
}

export interface WirePacket {
    payload: Uint8Array;
    sequence: number;
    type: WirePacketType;
}
