import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { UserInputRequest, UserInputResponse } from "@/protocol";

export interface UserInputPanelProps {
    isAborting: boolean;
    onAbort: () => void;
    onAnswer: (requestId: string, response: UserInputResponse) => Promise<void>;
    request: UserInputRequest;
}

export function UserInputPanel(props: UserInputPanelProps) {
    const [selected, setSelected] = useState<Record<string, readonly string[]>>({});
    const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | undefined>();

    const answers = useMemo(() => {
        const result: Record<string, readonly string[]> = {};
        for (const question of props.request.questions) {
            const other = otherAnswers[question.id]?.trim();
            result[question.id] = [
                ...(selected[question.id] ?? []),
                ...(other === undefined || other === "" ? [] : [other]),
            ];
        }
        return result;
    }, [otherAnswers, props.request.questions, selected]);

    const canSubmit = props.request.questions.every(
        (question) => (answers[question.id]?.length ?? 0) > 0,
    );

    const toggleOption = (questionId: string, label: string, multiSelect: boolean) => {
        setSelected((current) => {
            const existing = current[questionId] ?? [];
            const next = multiSelect
                ? existing.includes(label)
                    ? existing.filter((answer) => answer !== label)
                    : [...existing, label]
                : [label];
            return { ...current, [questionId]: next };
        });
        if (!multiSelect) {
            setOtherAnswers((current) => ({ ...current, [questionId]: "" }));
        }
    };

    const submit = async () => {
        if (!canSubmit || isSubmitting) return;
        setIsSubmitting(true);
        setErrorMessage(undefined);
        try {
            await props.onAnswer(props.request.requestId, { answers });
        } catch (error) {
            setErrorMessage(
                error instanceof Error ? error.message : "The answer could not be sent.",
            );
            setIsSubmitting(false);
        }
    };

    return (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
            <div className="border-b border-border/60 px-4 py-3">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    Rig needs your input
                </p>
                <p className="mt-1 text-sm text-foreground/90">
                    Choose an answer to continue the response.
                </p>
            </div>
            <div className="max-h-[48vh] space-y-5 overflow-y-auto px-4 py-4">
                {props.request.questions.map((question, questionIndex) => (
                    <fieldset className="space-y-2.5" key={question.id}>
                        <legend className="w-full">
                            <span className="mr-2 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                                {question.header}
                            </span>
                            <span className="text-sm font-medium text-foreground">
                                {question.question}
                            </span>
                            {props.request.questions.length > 1 && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {questionIndex + 1}/{props.request.questions.length}
                                </span>
                            )}
                        </legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {question.options.map((option) => {
                                const isSelected = (selected[question.id] ?? []).includes(
                                    option.label,
                                );
                                return (
                                    <button
                                        aria-pressed={isSelected}
                                        className={cn(
                                            "rounded-lg border px-3 py-2.5 text-left transition-colors",
                                            isSelected
                                                ? "border-primary/60 bg-primary/10"
                                                : "border-border/70 bg-background hover:border-border hover:bg-muted/30",
                                        )}
                                        key={option.label}
                                        onClick={() =>
                                            toggleOption(
                                                question.id,
                                                option.label,
                                                question.multiSelect,
                                            )
                                        }
                                        type="button"
                                    >
                                        <span className="block text-xs font-medium text-foreground">
                                            {isSelected ? "✓ " : ""}
                                            {option.label}
                                        </span>
                                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                                            {option.description}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <Input
                            aria-label={`Another answer for ${question.question}`}
                            className="h-8 text-xs"
                            onChange={(event) => {
                                const value = event.target.value;
                                setOtherAnswers((current) => ({
                                    ...current,
                                    [question.id]: value,
                                }));
                                if (!question.multiSelect && value.trim() !== "") {
                                    setSelected((current) => ({
                                        ...current,
                                        [question.id]: [],
                                    }));
                                }
                            }}
                            placeholder="Type another answer"
                            value={otherAnswers[question.id] ?? ""}
                        />
                    </fieldset>
                ))}
                {errorMessage !== undefined && (
                    <p className="text-xs text-destructive">{errorMessage}</p>
                )}
            </div>
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
                <Button
                    disabled={props.isAborting || isSubmitting}
                    onClick={props.onAbort}
                    size="sm"
                    type="button"
                    variant="ghost"
                >
                    {props.isAborting ? "Stopping…" : "Stop response"}
                </Button>
                <Button
                    disabled={!canSubmit || isSubmitting}
                    onClick={() => void submit()}
                    size="sm"
                    type="button"
                >
                    {isSubmitting ? "Sending…" : "Continue"}
                </Button>
            </div>
        </div>
    );
}
