import type {
    DurableUserInputOptions,
    UserInputRequest,
    UserInputResponse,
} from "../../user-input/index.js";

export interface UserInputContext {
    markExecuting?(requestId: string): void;
    request(
        request: UserInputRequest,
        options?: { durable?: DurableUserInputOptions; signal?: AbortSignal },
    ): Promise<UserInputResponse>;
}
