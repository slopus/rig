import { type ChangeEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { searchFiles } from "@/api";
import { PromptInputTextarea } from "@/components/ai/prompt-input";
import { FileMentionMenu } from "@/components/chat/FileMentionMenu";
import { fileMentionKey } from "@/components/chat/fileMentionKey";
import {
    type ActiveFileMention,
    findActiveFileMention,
} from "@/components/chat/findActiveFileMention";
import { formatFileMention } from "@/components/chat/formatFileMention";
import type { FileSearchResult } from "@/protocol";

const FILE_SEARCH_LIMIT = 10;
const FILE_SEARCH_DEBOUNCE_MS = 80;

export interface FileMentionTextareaProps {
    disabled: boolean;
    onTextChange: (hasText: boolean) => void;
    placeholder: string;
    sessionId: string;
}

export function FileMentionTextarea({
    disabled,
    onTextChange,
    placeholder,
    sessionId,
}: FileMentionTextareaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dismissedMentionKey = useRef<string | undefined>(undefined);
    const menuId = useId();
    const [files, setFiles] = useState<readonly FileSearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [mention, setMention] = useState<ActiveFileMention | undefined>(undefined);
    const [selectedIndex, setSelectedIndex] = useState(0);

    const closeMenu = () => {
        setFiles([]);
        setIsLoading(false);
        setMention(undefined);
        setSelectedIndex(0);
    };

    const updateMention = (text: string, cursor: number) => {
        const nextMention = findActiveFileMention(text, cursor);
        if (nextMention === undefined) {
            dismissedMentionKey.current = undefined;
            closeMenu();
            return;
        }

        const key = fileMentionKey(nextMention);
        if (dismissedMentionKey.current === key) {
            closeMenu();
            return;
        }
        dismissedMentionKey.current = undefined;
        setFiles([]);
        setMention(nextMention);
        setSelectedIndex(0);
    };

    useEffect(() => {
        if (mention === undefined || disabled) {
            return;
        }

        const controller = new AbortController();
        setIsLoading(true);
        const timer = window.setTimeout(() => {
            void searchFiles(sessionId, mention.query, FILE_SEARCH_LIMIT, controller.signal).then(
                (response) => {
                    if (!controller.signal.aborted) {
                        setFiles(response.files);
                        setIsLoading(false);
                        setSelectedIndex(0);
                    }
                },
                () => {
                    if (!controller.signal.aborted) {
                        setFiles([]);
                        setIsLoading(false);
                    }
                },
            );
        }, FILE_SEARCH_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [disabled, mention, sessionId]);

    useEffect(() => {
        const form = textareaRef.current?.form;
        if (form === null || form === undefined) {
            return;
        }
        form.addEventListener("reset", closeMenu);
        return () => form.removeEventListener("reset", closeMenu);
    }, []);

    const applyFileMention = (file: FileSearchResult) => {
        const textarea = textareaRef.current;
        if (textarea === null || mention === undefined) {
            return;
        }

        const afterMention = textarea.value.slice(mention.end);
        const suffix = afterMention.length === 0 || !/^\s/u.test(afterMention) ? " " : "";
        textarea.setRangeText(
            `${formatFileMention(file.path)}${suffix}`,
            mention.start,
            mention.end,
            "end",
        );
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.focus();
        dismissedMentionKey.current = undefined;
        closeMenu();
    };

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        onTextChange(event.currentTarget.value.trim() !== "");
        updateMention(event.currentTarget.value, event.currentTarget.selectionStart);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (mention === undefined) {
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            dismissedMentionKey.current = fileMentionKey(mention);
            closeMenu();
            return;
        }
        if (files.length === 0) {
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((current) => (current + files.length - 1) % files.length);
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((current) => (current + 1) % files.length);
            return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const selected = files[selectedIndex] ?? files[0];
            if (selected !== undefined) {
                applyFileMention(selected);
            }
        }
    };

    const menuOpen = mention !== undefined;

    return (
        <>
            {menuOpen && (
                <FileMentionMenu
                    files={files}
                    id={menuId}
                    isLoading={isLoading}
                    onSelect={applyFileMention}
                    selectedIndex={selectedIndex}
                />
            )}
            <PromptInputTextarea
                aria-activedescendant={
                    files.length > 0 ? `${menuId}-option-${selectedIndex}` : undefined
                }
                aria-controls={menuOpen ? menuId : undefined}
                aria-expanded={menuOpen}
                aria-haspopup="listbox"
                disabled={disabled}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onSelect={(event) =>
                    updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
                }
                placeholder={placeholder}
                ref={textareaRef}
            />
        </>
    );
}
