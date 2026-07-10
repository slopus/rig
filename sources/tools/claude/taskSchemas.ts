import { Type } from "@sinclair/typebox";

export const taskStatusSchema = Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
]);

export const sessionTaskSchema = Type.Object(
    {
        id: Type.String(),
        subject: Type.String(),
        description: Type.String(),
        activeForm: Type.Optional(Type.String()),
        owner: Type.Optional(Type.String()),
        status: taskStatusSchema,
        blocks: Type.Array(Type.String()),
        blockedBy: Type.Array(Type.String()),
        metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    },
    { additionalProperties: false },
);

export const taskMetadataSchema = Type.Record(Type.String(), Type.Unknown());
