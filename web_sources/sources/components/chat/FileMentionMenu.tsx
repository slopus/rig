import { FileIcon, Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FileSearchResult } from "@/protocol";

export interface FileMentionMenuProps {
    files: readonly FileSearchResult[];
    id: string;
    isLoading: boolean;
    onSelect: (file: FileSearchResult) => void;
    selectedIndex: number;
}

export function FileMentionMenu({
    files,
    id,
    isLoading,
    onSelect,
    selectedIndex,
}: FileMentionMenuProps) {
    return (
        <div
            aria-label="Workspace files"
            className="border-border/70 max-h-56 overflow-y-auto border-b bg-muted/25 p-1.5"
            id={id}
            role="listbox"
        >
            {files.map((file, index) => {
                const slashIndex = file.path.lastIndexOf("/");
                const location =
                    slashIndex === -1 ? "Workspace root" : file.path.slice(0, slashIndex);
                const isSelected = index === selectedIndex;
                return (
                    <button
                        aria-selected={isSelected}
                        className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                            isSelected
                                ? "bg-accent text-accent-foreground"
                                : "text-foreground hover:bg-accent/60",
                        )}
                        id={`${id}-option-${index}`}
                        key={file.path}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onSelect(file)}
                        role="option"
                        type="button"
                    >
                        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium">{file.fileName}</span>
                        <span className="max-w-1/2 truncate text-muted-foreground text-xs">
                            {location}
                        </span>
                    </button>
                );
            })}
            {isLoading && files.length === 0 && (
                <div className="flex items-center gap-2 px-2.5 py-2 text-muted-foreground text-sm">
                    <Loader2Icon className="size-3.5 animate-spin" />
                    <span>Searching workspace files…</span>
                </div>
            )}
            {!isLoading && files.length === 0 && (
                <p className="px-2.5 py-2 text-muted-foreground text-sm">
                    No matching files found.
                </p>
            )}
        </div>
    );
}
