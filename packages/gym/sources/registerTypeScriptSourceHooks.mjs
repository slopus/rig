import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const distributionPrefix = "file:///app/packages/rig/dist/";
const sourcePrefix = "file:///app/packages/rig/sources/";

registerHooks({
    resolve(specifier, context, nextResolve) {
        const fileSpecifier = specifier.startsWith("/app/packages/rig/dist/")
            ? new URL(`file://${specifier}`).href
            : specifier;
        if (fileSpecifier.startsWith(distributionPrefix) && fileSpecifier.endsWith(".js")) {
            const sourceUrl = `${sourcePrefix}${fileSpecifier.slice(distributionPrefix.length, -3)}.ts`;
            if (existsSync(new URL(sourceUrl))) return nextResolve(sourceUrl, context);
        }
        if (
            context.parentURL?.startsWith("file:") === true &&
            (specifier.startsWith("./") || specifier.startsWith("../")) &&
            specifier.endsWith(".js")
        ) {
            const sourceUrl = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
            if (existsSync(sourceUrl)) return nextResolve(sourceUrl.href, context);
        }
        return nextResolve(specifier, context);
    },
});
