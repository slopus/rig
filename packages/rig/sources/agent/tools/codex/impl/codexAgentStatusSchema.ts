import { Type } from "@sinclair/typebox";

export const codexAgentStatusSchema = Type.Union([
    Type.Literal("pending_init"),
    Type.Literal("running"),
    Type.Literal("interrupted"),
    Type.Literal("shutdown"),
    Type.Literal("not_found"),
    Type.Object(
        { completed: Type.Union([Type.String(), Type.Null()]) },
        { additionalProperties: false },
    ),
    Type.Object({ errored: Type.String() }, { additionalProperties: false }),
]);
