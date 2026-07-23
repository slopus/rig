export function collaborationItemsToText(
    items:
        | readonly {
              type?: string;
              text?: string;
              image_url?: string;
              audio_url?: string;
              path?: string;
              name?: string;
          }[]
        | undefined,
): string {
    return (
        items
            ?.flatMap((item) => {
                if (item.type === "text" && item.text !== undefined) return [item.text];
                if (item.type === "image" && item.image_url !== undefined) {
                    return [item.image_url];
                }
                if (item.type === "audio" && item.audio_url !== undefined) {
                    return [item.audio_url];
                }
                if (
                    (item.type === "local_image" ||
                        item.type === "local_audio" ||
                        item.type === "skill" ||
                        item.type === "mention") &&
                    item.path !== undefined
                ) {
                    return [item.name === undefined ? item.path : `${item.name}: ${item.path}`];
                }
                const fields = Object.entries(item).filter(([, value]) => value !== undefined);
                return fields.length === 0 ? [] : [JSON.stringify(Object.fromEntries(fields))];
            })
            .join("\n") ?? ""
    );
}
