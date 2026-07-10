import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function resolveClaudeCodeExecutablePath(): string {
    const executableSuffix = process.platform === "win32" ? ".exe" : "";
    const packagePrefix = "@anthropic-ai/claude-agent-sdk";
    let platformPackages: readonly string[];

    if (process.platform === "linux") {
        const standardPackage = `${packagePrefix}-linux-${process.arch}`;
        const muslPackage = `${standardPackage}-musl`;
        const report = process.report?.getReport() as
            | { header?: { glibcVersionRuntime?: string } }
            | undefined;
        platformPackages =
            report?.header?.glibcVersionRuntime === undefined
                ? [muslPackage, standardPackage]
                : [standardPackage, muslPackage];
    } else {
        platformPackages = [`${packagePrefix}-${process.platform}-${process.arch}`];
    }

    for (const packageName of platformPackages) {
        try {
            return require.resolve(`${packageName}/claude${executableSuffix}`);
        } catch {
            // Try the next executable compatible with this platform.
        }
    }

    throw new Error(
        `Claude Code is unavailable for ${process.platform}-${process.arch}. Reinstall Rig with optional dependencies enabled.`,
    );
}
