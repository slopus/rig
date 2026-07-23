export function collaborationItemsToText(
    items: readonly { type?: string; text?: string; path?: string; name?: string }[] | undefined,
): string {
    return (
        items
            ?.flatMap((item) => {
                if (item.type === "text" && item.text !== undefined) return [item.text];
                if (item.type === "mention" && item.path !== undefined) {
                    return [item.name === undefined ? item.path : `${item.name}: ${item.path}`];
                }
                return [];
            })
            .join("\n") ?? ""
    );
}
