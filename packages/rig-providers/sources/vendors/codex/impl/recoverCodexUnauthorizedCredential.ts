import type { CodexProviderCredential } from "@/vendors/VendorCredential.js";
import { CodexSessionCredential } from "@/vendors/codex/CodexSessionCredential.js";

export async function recoverCodexUnauthorizedCredential(
    credential: CodexProviderCredential,
    step: number,
): Promise<CodexSessionCredential | undefined> {
    if (!(credential instanceof CodexSessionCredential)) return undefined;
    if (step === 0) return credential.reloadForUnauthorized();
    if (step === 1) return credential.refreshForUnauthorized();
    return undefined;
}
