import { PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { createSession } from "@/api";
import { ModelCatalogOptions } from "@/components/ModelCatalogOptions";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { decodeProviderModelSelection } from "@/decodeProviderModelSelection";
import { encodeProviderModelSelection } from "@/encodeProviderModelSelection";
import type { ModelCatalog, ProtocolSession } from "@/protocol";

export interface NewSessionDialogProps {
    /** Model catalog from health; the model select is empty until it arrives. */
    catalog: ModelCatalog | undefined;
    /** True when the daemon is ready to accept new sessions. */
    daemonReady: boolean;
    /** Working directory prefill, usually the most recent session's cwd. */
    defaultCwd: string | undefined;
    /** Called with the created session so the app can select it. */
    onSessionCreated: (session: ProtocolSession) => void;
    /** Triggers an immediate session list re-fetch after creation. */
    refreshSessions: () => void;
}

/** "New Session" button plus the dialog that creates a session. */
export function NewSessionDialog(props: NewSessionDialogProps) {
    const { catalog, defaultCwd, onSessionCreated, refreshSessions } = props;

    const [open, setOpen] = useState(false);
    const [cwd, setCwd] = useState("");
    const [modelSelection, setModelSelection] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            setOpen(nextOpen);
            if (nextOpen) {
                setCwd(defaultCwd ?? "");
                setModelSelection(
                    catalog === undefined
                        ? ""
                        : encodeProviderModelSelection(
                              catalog.defaultProviderId,
                              catalog.defaultModelId,
                          ),
                );
                setError(undefined);
                setIsCreating(false);
            }
        },
        [catalog, defaultCwd],
    );

    const handleCreate = useCallback(async () => {
        const trimmedCwd = cwd.trim();
        if (trimmedCwd.length === 0 || isCreating) {
            return;
        }
        setIsCreating(true);
        setError(undefined);
        try {
            const selection = decodeProviderModelSelection(modelSelection);
            const response = await createSession({
                cwd: trimmedCwd,
                ...(selection !== undefined
                    ? { modelId: selection.modelId, providerId: selection.providerId }
                    : {}),
            });
            setOpen(false);
            refreshSessions();
            onSessionCreated(response.session);
        } catch (creationError) {
            setError(
                creationError instanceof Error
                    ? creationError.message
                    : "Could not create the session.",
            );
            setIsCreating(false);
        }
    }, [cwd, isCreating, modelSelection, onSessionCreated, refreshSessions]);

    const canCreate = cwd.trim().length > 0 && !isCreating;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    disabled={!props.daemonReady}
                    title="New session"
                >
                    <PlusIcon className="size-4" />
                    <span className="sr-only">New session</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void handleCreate();
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>New session</DialogTitle>
                        <DialogDescription>
                            Start a fresh agent conversation in a working directory.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="new-session-cwd"
                                className="text-xs font-medium text-muted-foreground"
                            >
                                Working directory
                            </label>
                            <Input
                                id="new-session-cwd"
                                value={cwd}
                                onChange={(event) => setCwd(event.target.value)}
                                placeholder="/path/to/project"
                                autoFocus
                                spellCheck={false}
                                autoComplete="off"
                                className="font-mono text-[13px]"
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="new-session-model"
                                className="text-xs font-medium text-muted-foreground"
                            >
                                Model
                            </label>
                            <Select
                                {...(modelSelection !== "" ? { value: modelSelection } : {})}
                                onValueChange={setModelSelection}
                            >
                                <SelectTrigger id="new-session-model" className="w-full">
                                    <SelectValue placeholder="Choose a model" />
                                </SelectTrigger>
                                <SelectContent>
                                    {catalog !== undefined && (
                                        <ModelCatalogOptions catalog={catalog} />
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        {error !== undefined && (
                            <p className="text-[13px] leading-5 text-destructive">{error}</p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setOpen(false)}
                            disabled={isCreating}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!canCreate}>
                            {isCreating ? "Creating…" : "Create session"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
