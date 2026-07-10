import { Loader2Icon, LockKeyholeIcon, SquareIcon } from "lucide-react";
import { useCallback, useState } from "react";

import {
    PromptInput,
    PromptInputActionAddAttachments,
    PromptInputAttachment,
    PromptInputAttachments,
    PromptInputBody,
    type PromptInputMessage,
    PromptInputSubmit,
    PromptInputToolbar,
    PromptInputTools,
    usePromptInputAttachments,
} from "@/components/ai/prompt-input";
import { fileUiPartToImageBlock } from "@/components/chat/fileUiPartToImageBlock";
import { FileMentionTextarea } from "@/components/chat/FileMentionTextarea";
import { Button } from "@/components/ui/button";
import type { ImageBlock } from "@/protocol";

export interface ChatComposerProps {
    /** False disables sending (daemon still starting or unreachable). */
    daemonReady: boolean;
    /** True after Stop was pressed, until the run settles. */
    isAborting: boolean;
    /** True while a run is active; morphs Send into Stop. */
    isRunning: boolean;
    /** Requests an abort of the active run. */
    onAbort: () => void;
    /**
     * Sends the message; images are protocol ImageBlocks (raw base64).
     * Resolves false when the send failed (the composer keeps the input).
     */
    onSubmit: (text: string, images: readonly ImageBlock[]) => Promise<boolean>;
    /** Locks the composer while a subagent history is being viewed. */
    readOnly: boolean;
    /** Session whose workspace is searched for file mentions. */
    sessionId: string;
}

interface ComposerActionsProps {
    daemonReady: boolean;
    hasText: boolean;
    isAborting: boolean;
    isRunning: boolean;
    onAbort: () => void;
    readOnly: boolean;
}

function ComposerActions({
    daemonReady,
    hasText,
    isAborting,
    isRunning,
    onAbort,
    readOnly,
}: ComposerActionsProps) {
    const attachments = usePromptInputAttachments();

    if (readOnly) {
        return (
            <Button
                aria-label="Subagent history is read-only"
                className="rounded-lg"
                disabled
                size="icon-sm"
                type="button"
                variant="outline"
            >
                <LockKeyholeIcon className="size-4" />
            </Button>
        );
    }

    if (isRunning) {
        return (
            <div className="flex items-center gap-1">
                {/*
                 * Hidden disabled submit target: the textarea's Enter handler
                 * checks the first submit button's disabled state, so this
                 * blocks Enter-to-send while a run is active.
                 */}
                <button aria-hidden className="hidden" disabled type="submit" />
                <Button
                    aria-label="Stop the run"
                    className="rounded-lg"
                    disabled={isAborting}
                    onClick={onAbort}
                    size="icon-sm"
                    type="button"
                    variant="outline"
                >
                    {isAborting ? (
                        <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                        <SquareIcon className="size-4" />
                    )}
                </Button>
            </div>
        );
    }

    const canSend = daemonReady && (hasText || attachments.files.length > 0);
    return <PromptInputSubmit disabled={!canSend} />;
}

/**
 * Message composer: textarea with Enter-to-send / Shift+Enter newline, image
 * attachments via file picker, clipboard paste or drag-and-drop, and a Send
 * button that morphs into Stop while a run is active.
 */
export function ChatComposer({
    daemonReady,
    isAborting,
    isRunning,
    onAbort,
    onSubmit,
    readOnly,
    sessionId,
}: ChatComposerProps) {
    const [hasText, setHasText] = useState(false);
    const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined);

    const handleSubmit = useCallback(
        async (message: PromptInputMessage) => {
            if (isRunning || readOnly) {
                return;
            }
            const text = message.text.trim();
            const images: ImageBlock[] = [];
            for (const file of message.files) {
                const image = fileUiPartToImageBlock(file);
                if (image !== undefined) {
                    images.push(image);
                }
            }
            if (text === "" && images.length === 0) {
                return;
            }
            setHasText(false);
            setAttachmentError(undefined);
            const sent = await onSubmit(text, images);
            if (!sent) {
                // Reject so PromptInput keeps the attachments and restores the
                // typed text; the failure itself is surfaced via runError.
                throw new Error("The message could not be sent.");
            }
        },
        [isRunning, onSubmit, readOnly],
    );

    const handleAttachmentError = useCallback(
        (error: { code: "max_files" | "max_file_size" | "accept"; message: string }) => {
            setAttachmentError(
                error.code === "accept" ? "Only image files can be attached." : error.message,
            );
        },
        [],
    );

    return (
        <div className="flex flex-col gap-1.5">
            <PromptInput
                accept="image/*"
                multiple
                onError={handleAttachmentError}
                onSubmit={handleSubmit}
            >
                <PromptInputBody>
                    <PromptInputAttachments>
                        {(attachment) => <PromptInputAttachment data={attachment} />}
                    </PromptInputAttachments>
                    <FileMentionTextarea
                        disabled={!daemonReady || readOnly}
                        onTextChange={setHasText}
                        placeholder={
                            readOnly
                                ? "Subagent history is read-only."
                                : daemonReady
                                  ? "Message the agent…"
                                  : "Waiting for the daemon to become ready…"
                        }
                        sessionId={sessionId}
                    />
                </PromptInputBody>
                <PromptInputToolbar>
                    <PromptInputTools>
                        <PromptInputActionAddAttachments disabled={!daemonReady || readOnly} />
                    </PromptInputTools>
                    <ComposerActions
                        daemonReady={daemonReady}
                        hasText={hasText}
                        isAborting={isAborting}
                        isRunning={isRunning}
                        onAbort={onAbort}
                        readOnly={readOnly}
                    />
                </PromptInputToolbar>
            </PromptInput>
            <div className="flex items-center justify-between px-1">
                <p className="text-muted-foreground/70 text-xs">
                    {readOnly
                        ? "Subagent histories cannot receive follow-up messages."
                        : "Enter to send · Shift+Enter for a new line · type @ to mention files"}
                </p>
                {attachmentError !== undefined && (
                    <p className="text-destructive text-xs">{attachmentError}</p>
                )}
            </div>
        </div>
    );
}
