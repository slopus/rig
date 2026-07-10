import { Type } from "@sinclair/typebox";

export const managedSubagentSchema = Type.Object({
    description: Type.String(),
    path: Type.String(),
    sessionId: Type.String(),
    status: Type.Union([
        Type.Literal("aborted"),
        Type.Literal("completed"),
        Type.Literal("error"),
        Type.Literal("running"),
    ]),
    taskName: Type.String(),
});
