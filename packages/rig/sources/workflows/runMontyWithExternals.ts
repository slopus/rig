import { Monty, MontyComplete, MontyNameLookup, type ResourceLimits } from "@pydantic/monty";

export async function runMontyWithExternals(options: {
    externalFunctions: Record<string, (...args: unknown[]) => unknown>;
    inputs: Record<string, unknown>;
    limits: ResourceLimits;
    monty: Monty;
    onPrint(text: string): void;
    signal: AbortSignal;
}): Promise<unknown> {
    let progress = options.monty.start({
        inputs: options.inputs,
        limits: options.limits,
        printCallback: (_stream: string, text: string) => options.onPrint(text),
    });
    while (!(progress instanceof MontyComplete)) {
        if (options.signal.aborted) throw new Error("The workflow was stopped.");
        if (progress instanceof MontyNameLookup) {
            const external = options.externalFunctions[progress.variableName];
            progress =
                external === undefined ? progress.resume() : progress.resume({ value: external });
            continue;
        }
        const external = options.externalFunctions[progress.functionName];
        if (external === undefined) {
            throw new Error(`Workflow function '${progress.functionName}' is unavailable.`);
        }
        const value = await external(...progress.args, progress.kwargs);
        progress = progress.resume({ returnValue: value });
    }
    return progress.output;
}
