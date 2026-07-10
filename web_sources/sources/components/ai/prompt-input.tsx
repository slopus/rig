import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CornerDownLeftIcon, Loader2Icon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react";
import {
    type ChangeEventHandler,
    Children,
    type ClipboardEventHandler,
    type ComponentProps,
    createContext,
    type FormEvent,
    type FormEventHandler,
    Fragment,
    type HTMLAttributes,
    type KeyboardEventHandler,
    type ReactNode,
    type RefObject,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { ChatStatus, FileUIPart } from "./types";

// Adapted from the AI Elements prompt-input registry item: the `ai` package
// types are replaced with local ones (./types), the shadcn input-group /
// command / hover-card dependencies are replaced with plain styled elements,
// and the model-select + speech extras are dropped.

export type AttachmentsContext = {
    files: (FileUIPart & { id: string })[];
    add: (files: File[] | FileList) => void;
    remove: (id: string) => void;
    clear: () => void;
    openFileDialog: () => void;
    fileInputRef: RefObject<HTMLInputElement | null>;
};

const AttachmentsContextInstance = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
    const context = useContext(AttachmentsContextInstance);
    if (!context) {
        throw new Error("usePromptInputAttachments must be used within a PromptInput");
    }
    return context;
};

export type PromptInputAttachmentProps = HTMLAttributes<HTMLDivElement> & {
    data: FileUIPart & { id: string };
    className?: string;
};

export function PromptInputAttachment({ data, className, ...props }: PromptInputAttachmentProps) {
    const attachments = usePromptInputAttachments();
    const filename = data.filename || "";
    const isImage = Boolean(data.mediaType?.startsWith("image/") && data.url);

    return (
        <div
            className={cn("group relative size-14 overflow-hidden rounded-md border", className)}
            {...props}
        >
            {isImage ? (
                <img
                    alt={filename || "attachment"}
                    className="size-full object-cover"
                    height={56}
                    src={data.url}
                    width={56}
                />
            ) : (
                <div className="flex size-full items-center justify-center bg-muted text-muted-foreground">
                    <PaperclipIcon className="size-4" />
                </div>
            )}
            <Button
                aria-label="Remove attachment"
                className="absolute top-0.5 right-0.5 size-5 rounded-full bg-background/80 p-0 opacity-0 backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100 [&>svg]:size-3"
                onClick={(e) => {
                    e.stopPropagation();
                    attachments.remove(data.id);
                }}
                type="button"
                variant="ghost"
            >
                <XIcon />
                <span className="sr-only">Remove</span>
            </Button>
        </div>
    );
}

export type PromptInputAttachmentsProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
    children: (attachment: FileUIPart & { id: string }) => ReactNode;
};

export function PromptInputAttachments({
    children,
    className,
    ...props
}: PromptInputAttachmentsProps) {
    const attachments = usePromptInputAttachments();

    if (!attachments.files.length) {
        return null;
    }

    return (
        <div
            className={cn("flex w-full flex-wrap items-center gap-2 p-3 pb-0", className)}
            {...props}
        >
            {attachments.files.map((file) => (
                <Fragment key={file.id}>{children(file)}</Fragment>
            ))}
        </div>
    );
}

export type PromptInputActionAddAttachmentsProps = ComponentProps<typeof Button> & {
    label?: string;
};

export const PromptInputActionAddAttachments = ({
    label = "Attach image",
    className,
    ...props
}: PromptInputActionAddAttachmentsProps) => {
    const attachments = usePromptInputAttachments();

    return (
        <PromptInputButton
            aria-label={label}
            className={className}
            onClick={(e) => {
                e.preventDefault();
                attachments.openFileDialog();
            }}
            {...props}
        >
            <PaperclipIcon className="size-4" />
            <span className="sr-only">{label}</span>
        </PromptInputButton>
    );
};

export type PromptInputMessage = {
    text: string;
    files: FileUIPart[];
};

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit" | "onError"> & {
    accept?: string; // e.g. "image/*"; leave undefined for any
    multiple?: boolean;
    maxFiles?: number;
    maxFileSize?: number; // bytes
    onError?: (err: { code: "max_files" | "max_file_size" | "accept"; message: string }) => void;
    onSubmit: (
        message: PromptInputMessage,
        event: FormEvent<HTMLFormElement>,
    ) => void | Promise<void>;
};

export const PromptInput = ({
    className,
    accept,
    multiple,
    maxFiles,
    maxFileSize,
    onError,
    onSubmit,
    children,
    ...props
}: PromptInputProps) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const formRef = useRef<HTMLFormElement | null>(null);

    const [items, setItems] = useState<(FileUIPart & { id: string })[]>([]);

    // Keep a ref to files for cleanup on unmount (avoids stale closure)
    const filesRef = useRef(items);
    filesRef.current = items;

    const openFileDialog = useCallback(() => {
        inputRef.current?.click();
    }, []);

    const matchesAccept = useCallback(
        (f: File) => {
            if (!accept || accept.trim() === "") {
                return true;
            }

            const patterns = accept
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);

            return patterns.some((pattern) => {
                if (pattern.endsWith("/*")) {
                    const prefix = pattern.slice(0, -1); // e.g. image/* -> image/
                    return f.type.startsWith(prefix);
                }
                return f.type === pattern;
            });
        },
        [accept],
    );

    const add = useCallback(
        (fileList: File[] | FileList) => {
            const incoming = Array.from(fileList);
            const accepted = incoming.filter((f) => matchesAccept(f));
            if (incoming.length && accepted.length === 0) {
                onError?.({
                    code: "accept",
                    message: "No files match the accepted types.",
                });
                return;
            }
            const withinSize = (f: File) => (maxFileSize ? f.size <= maxFileSize : true);
            const sized = accepted.filter(withinSize);
            if (accepted.length > 0 && sized.length === 0) {
                onError?.({
                    code: "max_file_size",
                    message: "All files exceed the maximum size.",
                });
                return;
            }

            setItems((prev) => {
                const capacity =
                    typeof maxFiles === "number" ? Math.max(0, maxFiles - prev.length) : undefined;
                const capped = typeof capacity === "number" ? sized.slice(0, capacity) : sized;
                if (typeof capacity === "number" && sized.length > capacity) {
                    onError?.({
                        code: "max_files",
                        message: "Too many files. Some were not added.",
                    });
                }
                const next: (FileUIPart & { id: string })[] = [];
                for (const file of capped) {
                    next.push({
                        id: crypto.randomUUID(),
                        type: "file",
                        url: URL.createObjectURL(file),
                        mediaType: file.type,
                        filename: file.name,
                    });
                }
                return prev.concat(next);
            });
        },
        [matchesAccept, maxFiles, maxFileSize, onError],
    );

    const remove = useCallback(
        (id: string) =>
            setItems((prev) => {
                const found = prev.find((file) => file.id === id);
                if (found?.url) {
                    URL.revokeObjectURL(found.url);
                }
                return prev.filter((file) => file.id !== id);
            }),
        [],
    );

    const clear = useCallback(
        () =>
            setItems((prev) => {
                for (const file of prev) {
                    if (file.url) {
                        URL.revokeObjectURL(file.url);
                    }
                }
                return [];
            }),
        [],
    );

    // Accept drops on the form
    useEffect(() => {
        const form = formRef.current;
        if (!form) {
            return;
        }

        const onDragOver = (e: DragEvent) => {
            if (e.dataTransfer?.types?.includes("Files")) {
                e.preventDefault();
            }
        };
        const onDrop = (e: DragEvent) => {
            if (e.dataTransfer?.types?.includes("Files")) {
                e.preventDefault();
            }
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                add(e.dataTransfer.files);
            }
        };
        form.addEventListener("dragover", onDragOver);
        form.addEventListener("drop", onDrop);
        return () => {
            form.removeEventListener("dragover", onDragOver);
            form.removeEventListener("drop", onDrop);
        };
    }, [add]);

    // Cleanup object URLs on unmount
    useEffect(
        () => () => {
            for (const f of filesRef.current) {
                if (f.url) {
                    URL.revokeObjectURL(f.url);
                }
            }
        },
        [],
    );

    const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
        if (event.currentTarget.files) {
            add(event.currentTarget.files);
        }
        // Reset input value to allow selecting files that were previously removed
        event.currentTarget.value = "";
    };

    const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
            });
        } catch {
            return null;
        }
    };

    const ctx = useMemo<AttachmentsContext>(
        () => ({
            files: items,
            add,
            remove,
            clear,
            openFileDialog,
            fileInputRef: inputRef,
        }),
        [items, add, remove, clear, openFileDialog],
    );

    const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
        event.preventDefault();

        const form = event.currentTarget;
        const formData = new FormData(form);
        const text = (formData.get("message") as string) || "";

        // Reset the form immediately after capturing text so user input typed
        // during the async blob conversion is not lost
        form.reset();

        // Puts the captured text back into the textarea after a failed send so
        // the user does not have to retype it (skipped when they already typed
        // something new). Goes through the native value setter so React's
        // onChange fires.
        const restoreText = () => {
            const textarea = form.elements.namedItem("message");
            if (!(textarea instanceof HTMLTextAreaElement) || textarea.value !== "") {
                return;
            }
            const setValue = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
            )?.set;
            setValue?.call(textarea, text);
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        };

        Promise.all(
            items.map(async ({ id: _id, ...item }) => {
                if (item.url?.startsWith("blob:")) {
                    const dataUrl = await convertBlobUrlToDataUrl(item.url);
                    return {
                        ...item,
                        url: dataUrl ?? item.url,
                    };
                }
                return item;
            }),
        )
            .then((convertedFiles: FileUIPart[]) => {
                try {
                    const result = onSubmit({ text, files: convertedFiles }, event);
                    if (result instanceof Promise) {
                        result
                            .then(() => clear())
                            .catch(() => {
                                // Don't clear attachments on error - user may want to retry
                                restoreText();
                            });
                    } else {
                        clear();
                    }
                } catch {
                    // Don't clear attachments on error - user may want to retry
                    restoreText();
                }
            })
            .catch(() => {
                // Don't clear attachments on error - user may want to retry
                restoreText();
            });
    };

    return (
        <AttachmentsContextInstance.Provider value={ctx}>
            <input
                accept={accept}
                aria-label="Upload files"
                className="hidden"
                multiple={multiple}
                onChange={handleChange}
                ref={inputRef}
                title="Upload files"
                type="file"
            />
            <form
                className={cn(
                    "relative flex w-full flex-col overflow-hidden rounded-xl border bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
                    className,
                )}
                onSubmit={handleSubmit}
                ref={formRef}
                {...props}
            >
                {children}
            </form>
        </AttachmentsContextInstance.Provider>
    );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
    <div className={cn("contents", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<typeof Textarea>;

export const PromptInputTextarea = ({
    onChange,
    onKeyDown,
    className,
    placeholder = "What would you like to know?",
    ...props
}: PromptInputTextareaProps) => {
    const attachments = usePromptInputAttachments();
    const [isComposing, setIsComposing] = useState(false);

    const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) {
            return;
        }

        if (e.key === "Enter") {
            if (isComposing || e.nativeEvent.isComposing) {
                return;
            }
            if (e.shiftKey) {
                return;
            }
            e.preventDefault();

            // Check if the submit button is disabled before submitting
            const form = e.currentTarget.form;
            const submitButton = form?.querySelector(
                'button[type="submit"]',
            ) as HTMLButtonElement | null;
            if (submitButton?.disabled) {
                return;
            }

            form?.requestSubmit();
        }

        // Remove last attachment when Backspace is pressed and textarea is empty
        if (e.key === "Backspace" && e.currentTarget.value === "" && attachments.files.length > 0) {
            e.preventDefault();
            const lastAttachment = attachments.files.at(-1);
            if (lastAttachment) {
                attachments.remove(lastAttachment.id);
            }
        }
    };

    const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
        const clipboardItems = event.clipboardData?.items;

        if (!clipboardItems) {
            return;
        }

        const files: File[] = [];

        for (const item of clipboardItems) {
            if (item.kind === "file") {
                const file = item.getAsFile();
                if (file) {
                    files.push(file);
                }
            }
        }

        if (files.length > 0) {
            event.preventDefault();
            attachments.add(files);
        }
    };

    return (
        <Textarea
            className={cn(
                "field-sizing-content max-h-48 min-h-16 w-full resize-none rounded-none border-none bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
                className,
            )}
            name="message"
            onChange={onChange}
            onCompositionEnd={() => setIsComposing(false)}
            onCompositionStart={() => setIsComposing(true)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            {...props}
        />
    );
};

export type PromptInputToolbarProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputToolbar = ({ className, ...props }: PromptInputToolbarProps) => (
    <div className={cn("flex items-center justify-between gap-1 p-1", className)} {...props} />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
    <div className={cn("flex items-center gap-1", className)} {...props} />
);

export type PromptInputButtonProps = ComponentProps<typeof Button>;

export const PromptInputButton = ({
    variant = "ghost",
    className,
    size,
    ...props
}: PromptInputButtonProps) => {
    const newSize = size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm");

    return (
        <Button
            className={cn("shrink-0 gap-1.5 rounded-lg", className)}
            size={newSize}
            type="button"
            variant={variant}
            {...props}
        />
    );
};

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
    status?: ChatStatus;
};

export const PromptInputSubmit = ({
    className,
    variant = "default",
    size = "icon-sm",
    status,
    children,
    ...props
}: PromptInputSubmitProps) => {
    let Icon = <CornerDownLeftIcon className="size-4" />;

    if (status === "submitted") {
        Icon = <Loader2Icon className="size-4 animate-spin" />;
    } else if (status === "streaming") {
        Icon = <SquareIcon className="size-4" />;
    } else if (status === "error") {
        Icon = <XIcon className="size-4" />;
    }

    return (
        <Button
            aria-label="Submit"
            className={cn("shrink-0 rounded-lg", className)}
            size={size}
            type="submit"
            variant={variant}
            {...props}
        >
            {children ?? Icon}
        </Button>
    );
};
