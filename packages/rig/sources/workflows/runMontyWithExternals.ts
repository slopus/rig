import { Buffer } from "node:buffer";

import {
    Monty,
    MontyComplete,
    MontyNameLookup,
    MontySnapshot,
    type ResourceLimits,
} from "@pydantic/monty";

export async function runMontyWithExternals(options: {
    code: string;
    externalFunctions: Record<string, (...args: unknown[]) => unknown>;
    inputNames: string[];
    inputs: Record<string, unknown>;
    limits: ResourceLimits;
    onPrint(text: string): void;
    onSnapshot(snapshot: Uint8Array): void;
    signal: AbortSignal;
    snapshot?: Uint8Array;
    scriptName: string;
}): Promise<unknown> {
    const printCallback = (_stream: string, text: string) => options.onPrint(text);
    let progress: ReturnType<Monty["start"]> | undefined =
        options.snapshot === undefined
            ? new Monty(options.code, {
                  inputs: options.inputNames,
                  scriptName: options.scriptName,
              }).start({
                  inputs: options.inputs,
                  limits: options.limits,
                  printCallback,
              })
            : MontySnapshot.load(Buffer.from(options.snapshot), { printCallback });
    for (;;) {
        if (progress === undefined) throw new Error("The workflow snapshot was released early.");
        if (progress instanceof MontyComplete) return progress.output;
        if (options.signal.aborted) throw new Error("The workflow was stopped.");
        if (progress instanceof MontyNameLookup) {
            const external: ((...args: unknown[]) => unknown) | undefined =
                options.externalFunctions[progress.variableName];
            progress =
                external === undefined ? progress.resume() : progress.resume({ value: external });
            continue;
        }
        const external: ((...args: unknown[]) => unknown) | undefined =
            options.externalFunctions[progress.functionName];
        if (external === undefined) {
            throw new Error(`Workflow function '${progress.functionName}' is unavailable.`);
        }
        const args = progress.args;
        const kwargs = progress.kwargs;
        const snapshot: Uint8Array = new Uint8Array(progress.dump());
        options.onSnapshot(snapshot);

        // A serialized checkpoint is the only interpreter state allowed to cross a host await.
        // Loading it again gives every Python segment a fresh runtime budget.
        progress = undefined;
        const value = await external(...args, kwargs);
        progress = MontySnapshot.load(Buffer.from(snapshot), { printCallback }).resume({
            returnValue: value,
        });
    }
}
