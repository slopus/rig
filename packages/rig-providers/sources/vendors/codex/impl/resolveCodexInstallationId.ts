import { homedir } from "node:os";
import { join } from "node:path";

import { resolveCodexInstallationIdAt } from "@/vendors/codex/impl/resolveCodexInstallationIdAt.js";

const installationIds = new Map<string, Promise<string>>();

/** Reuses the installation identity persisted by Codex CLI on this machine. */
export function resolveCodexInstallationId(): Promise<string> {
    const configuredHome = process.env.CODEX_HOME?.trim();
    const codexHome =
        configuredHome === undefined || configuredHome.length === 0
            ? join(homedir(), ".codex")
            : configuredHome;
    const cached = installationIds.get(codexHome);
    if (cached !== undefined) return cached;
    const pending = resolveCodexInstallationIdAt(codexHome);
    installationIds.set(codexHome, pending);
    pending.catch(() => installationIds.delete(codexHome));
    return pending;
}
