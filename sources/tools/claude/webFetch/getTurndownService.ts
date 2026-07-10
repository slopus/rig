import type TurndownService from "turndown";

let servicePromise: Promise<TurndownService> | undefined;

export function getTurndownService(): Promise<TurndownService> {
    servicePromise ??= import("turndown").then(({ default: Turndown }) => new Turndown());
    return servicePromise;
}
