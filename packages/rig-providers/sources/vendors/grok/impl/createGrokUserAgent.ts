import { arch, platform } from "node:process";

import { GROK_BUILD_CLIENT_VERSION } from "@/vendors/grok/impl/grokConstants.js";

export function createGrokUserAgent(): string {
    const operatingSystem = platform === "darwin" ? "macos" : platform;
    const architecture = arch === "arm64" ? "aarch64" : arch;
    return `grok-shell/${GROK_BUILD_CLIENT_VERSION} (${operatingSystem}; ${architecture})`;
}
