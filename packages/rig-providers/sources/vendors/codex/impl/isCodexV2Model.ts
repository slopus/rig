import { getCodexModelProperties } from "@/vendors/codex/impl/getCodexModelProperties.js";

export function isCodexV2Model(model: string): boolean {
    return getCodexModelProperties(model)?.responsesLite ?? false;
}
