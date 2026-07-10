import type { ActiveFileMention } from "@/components/chat/findActiveFileMention";

export function fileMentionKey(mention: ActiveFileMention): string {
    return `${mention.start}:${mention.end}:${mention.prefix}`;
}
