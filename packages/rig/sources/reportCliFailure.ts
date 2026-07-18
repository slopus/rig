import { errorToMessage } from "./errorToMessage.js";

export function reportCliFailure(error: unknown): void {
    console.error(`Rig could not start: ${errorToMessage(error)}`);
    process.exitCode = 1;
}
