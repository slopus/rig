import { ArrowRightIcon } from "lucide-react";

import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai/tool";
import type { ToolState } from "@/components/ai/types";
import { Button } from "@/components/ui/button";
import { humanizeToolName } from "@/humanizeToolName";
import type { ImageBlock, SubagentSummary, TextBlock, ToolResultBlock } from "@/protocol";

export interface ToolCallViewProps {
    /** Tool call arguments (may be partial while the call is still streaming). */
    args: unknown;
    /**
     * True while the session's run is active. A result-less call on an idle
     * session renders as interrupted instead of running forever.
     */
    isSessionRunning?: boolean;
    /** True while the model is still streaming the call's arguments. */
    isStreamingArgs?: boolean;
    /** Tool name as requested by the model. */
    name: string;
    /** Matching tool_result block, if the tool has finished. */
    result: ToolResultBlock | undefined;
    /** Child session created by this tool call, when available. */
    subagent?: SubagentSummary | undefined;
    /** Opens the child session's read-only history. */
    onOpenSubagent?: ((sessionId: string) => void) | undefined;
}

function toolStateFor(
    result: ToolResultBlock | undefined,
    isStreamingArgs: boolean,
    isSessionRunning: boolean,
): ToolState {
    if (result !== undefined) {
        return result.isError === true ? "output-error" : "output-available";
    }
    if (isStreamingArgs) {
        return "input-streaming";
    }
    return isSessionRunning ? "input-available" : "interrupted";
}

/**
 * A tool_call block paired (by toolCallId) with its tool_result: collapsible
 * card with name + status, always-visible `display` summary, argument JSON and
 * the rendered result inside.
 */
export function ToolCallView({
    args,
    isSessionRunning = true,
    isStreamingArgs = false,
    name,
    onOpenSubagent,
    result,
    subagent,
}: ToolCallViewProps) {
    const state = toolStateFor(result, isStreamingArgs, isSessionRunning);

    const renderedText =
        result?.rendered
            .filter((block): block is TextBlock => block.type === "text")
            .map((block) => block.text)
            .join("\n\n") ?? "";
    const renderedImages =
        result?.rendered.filter((block): block is ImageBlock => block.type === "image") ?? [];

    const errorText =
        result?.isError === true ? result.display || "The tool reported an error." : undefined;
    const output = renderedText !== "" ? renderedText : undefined;

    return (
        <Tool className="mb-0 w-full">
            <ToolHeader state={state} title={humanizeToolName(name)} />
            {result !== undefined && result.display !== "" && (
                <div className="border-t px-3 py-2 font-mono text-muted-foreground text-xs">
                    {result.display}
                </div>
            )}
            {subagent !== undefined && onOpenSubagent !== undefined && (
                <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {subagent.description}
                    </span>
                    <Button
                        className="shrink-0 gap-1.5"
                        onClick={() => onOpenSubagent(subagent.id)}
                        size="sm"
                        type="button"
                        variant="ghost"
                    >
                        View history
                        <ArrowRightIcon className="size-3.5" />
                    </Button>
                </div>
            )}
            <ToolContent>
                <ToolInput className="border-t" input={args} />
                {errorText !== undefined ? (
                    <ToolOutput errorText={errorText} output={output} />
                ) : (
                    output !== undefined && <ToolOutput output={output} />
                )}
                {renderedImages.length > 0 && (
                    <div className="flex flex-wrap gap-2 p-4 pt-0">
                        {renderedImages.map((image, index) => (
                            <img
                                alt={`Tool result ${index + 1}`}
                                className="max-h-64 rounded-md border object-contain"
                                key={index}
                                src={`data:${image.mediaType};base64,${image.data}`}
                            />
                        ))}
                    </div>
                )}
            </ToolContent>
        </Tool>
    );
}
