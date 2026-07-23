import { Type } from "@sinclair/typebox";

export const collaborationItemsSchema = Type.Array(
    Type.Object(
        {
            type: Type.Optional(Type.String()),
            text: Type.Optional(Type.String()),
            image_url: Type.Optional(Type.String()),
            audio_url: Type.Optional(Type.String()),
            path: Type.Optional(Type.String()),
            name: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
    ),
    {
        description:
            "Structured input items. Use this to pass explicit mentions (for example app:// connector paths).",
    },
);
