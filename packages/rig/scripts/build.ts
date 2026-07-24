import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { builtinModules } from "node:module";
import { promisify } from "node:util";

import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const externalPackages = [
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/sandbox-runtime",
    "@anthropic-ai/sdk",
    "@ff-labs/fff-node",
    "@lydell/node-pty",
    "@mariozechner/clipboard",
    "@modelcontextprotocol/sdk",
    "@mongodb-js/zstd",
    "@pydantic/monty",
    "@slopus/ghostty-wasm",
    "@vscode/ripgrep",
    "bufferutil",
    "cpu-features",
    "node-liblzma",
    "sharp",
    "ssh2",
    "supports-color",
    "utf-8-validate",
    "zod",
];

await rm("dist", { force: true, recursive: true });
await mkdir("dist", { recursive: true });
await execFileAsync("tsc", ["-p", "tsconfig.build.json"]);
const result = await build({
    banner: {
        js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
    },
    bundle: true,
    entryNames: "[name]",
    entryPoints: {
        main: "sources/main.ts",
        readPackageVersion: "sources/readPackageVersion.ts",
    },
    external: externalPackages,
    format: "esm",
    legalComments: "none",
    metafile: true,
    outdir: "dist",
    packages: "bundle",
    platform: "node",
    target: "node20",
});
const bundledInputs = Object.keys(result.metafile.inputs);
for (const internalPackage of ["rig-execution", "rig-providers"]) {
    if (!bundledInputs.some((input) => input.includes(`/${internalPackage}/dist/`))) {
        throw new Error(`The Rig bundle did not include ${internalPackage}.`);
    }
}
const unexpectedExternalImports = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter(
        (import_) =>
            import_.external &&
            !import_.path.startsWith("node:") &&
            !builtinModules.includes(import_.path) &&
            !externalPackages.some(
                (packageName) =>
                    import_.path === packageName || import_.path.startsWith(`${packageName}/`),
            ),
    );
if (unexpectedExternalImports.length > 0) {
    throw new Error(
        `The Rig bundle left unexpected packages external: ${unexpectedExternalImports
            .map((import_) => import_.path)
            .join(", ")}.`,
    );
}
await cp(
    "sources/agent/skills/codex-skills-instructions.template.md",
    "dist/codex-skills-instructions.template.md",
);
