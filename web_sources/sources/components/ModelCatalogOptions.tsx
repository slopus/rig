import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { humanizeModelId } from "@/humanizeModelId";
import type { ModelCatalog } from "@/protocol";
import { encodeProviderModelSelection } from "@/encodeProviderModelSelection";

/**
 * Model catalog rendered as Select options — the single grouping rule shared
 * by every model picker: grouped by provider when there is more than one
 * provider, a flat list otherwise.
 */
export function ModelCatalogOptions(props: { catalog: ModelCatalog }) {
    if (props.catalog.providers.length > 1) {
        return (
            <>
                {props.catalog.providers.map((provider) => (
                    <SelectGroup key={provider.providerId}>
                        <SelectLabel>{humanizeModelId(provider.providerId)}</SelectLabel>
                        {provider.models.map((model) => (
                            <SelectItem
                                key={`${provider.providerId}:${model.id}`}
                                value={encodeProviderModelSelection(provider.providerId, model.id)}
                            >
                                {model.name}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                ))}
            </>
        );
    }
    const provider = props.catalog.providers[0];
    const providerId = provider?.providerId ?? props.catalog.defaultProviderId;
    const models = provider?.models ?? props.catalog.models;
    return (
        <>
            {models.map((model) => (
                <SelectItem
                    key={`${providerId}:${model.id}`}
                    value={encodeProviderModelSelection(providerId, model.id)}
                >
                    {model.name}
                </SelectItem>
            ))}
        </>
    );
}
