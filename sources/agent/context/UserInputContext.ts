import type { UserInputRequest, UserInputResponse } from "../../user-input/index.js";

export interface UserInputContext {
    request(
        request: UserInputRequest,
        options?: { signal?: AbortSignal },
    ): Promise<UserInputResponse>;
}
