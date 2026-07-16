import { createGymProvider } from "./createGymProvider.js";
import { readGymContextWindow } from "./readGymContextWindow.js";
import type { Provider } from "./types.js";

export function createGymProviderFromEnvironment(env: NodeJS.ProcessEnv): Provider | undefined {
    const endpoint = env.RIG_GYM_INFERENCE_URL;
    if (endpoint === undefined || endpoint.trim().length === 0) return undefined;
    const contextWindow = readGymContextWindow(env);
    return createGymProvider({
        ...(contextWindow === undefined ? {} : { contextWindow }),
        endpoint,
        ...(env.RIG_GYM_TOKEN === undefined ? {} : { token: env.RIG_GYM_TOKEN }),
    });
}
