import { useState } from "react";

import { ModelCatalogOptions } from "@/components/ModelCatalogOptions";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { humanizeModelId } from "@/humanizeModelId";
import type { ModelCatalog } from "@/protocol";
import { decodeProviderModelSelection } from "@/decodeProviderModelSelection";
import { encodeProviderModelSelection } from "@/encodeProviderModelSelection";

export interface ModelSelectProps {
    /** Model catalog from health; when missing the select is disabled. */
    catalog: ModelCatalog | undefined;
    /** Disables the control (e.g. model locked or a run in flight). */
    disabled: boolean;
    /** Currently selected model id. */
    modelId: string;
    /** Called with the selected provider and model; rejection is surfaced inline. */
    onChangeModel: (providerId: string, modelId: string) => Promise<void>;
    /** Currently selected inference provider id. */
    providerId: string;
}

/** Model picker for the Details tab, wired to the PATCH model endpoint. */
export function ModelSelect(props: ModelSelectProps) {
    const [isPending, setIsPending] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

    const providers = props.catalog?.providers ?? [];
    const knownSelections = new Set(
        providers.flatMap((provider) =>
            provider.models.map((model) =>
                encodeProviderModelSelection(provider.providerId, model.id),
            ),
        ),
    );
    const selectedValue = encodeProviderModelSelection(props.providerId, props.modelId);

    const handleChange = (value: string) => {
        const selection = decodeProviderModelSelection(value);
        if (
            selection === undefined ||
            (selection.modelId === props.modelId && selection.providerId === props.providerId)
        ) {
            return;
        }
        setIsPending(true);
        setErrorMessage(undefined);
        props
            .onChangeModel(selection.providerId, selection.modelId)
            .catch((error: unknown) => {
                setErrorMessage(
                    error instanceof Error ? error.message : "The model could not be changed.",
                );
            })
            .finally(() => {
                setIsPending(false);
            });
    };

    return (
        <div className="flex flex-col gap-1">
            <Select
                disabled={props.disabled || isPending || props.catalog === undefined}
                onValueChange={handleChange}
                value={selectedValue}
            >
                <SelectTrigger className="h-8 w-full font-mono text-xs" size="sm">
                    <SelectValue placeholder={humanizeModelId(props.modelId)} />
                </SelectTrigger>
                <SelectContent position="popper">
                    {props.catalog !== undefined && <ModelCatalogOptions catalog={props.catalog} />}
                    {!knownSelections.has(selectedValue) && (
                        <SelectItem value={selectedValue}>
                            {humanizeModelId(props.modelId)}
                        </SelectItem>
                    )}
                </SelectContent>
            </Select>
            {errorMessage !== undefined && <p className="text-xs text-red-400">{errorMessage}</p>}
        </div>
    );
}
