import type { Usage } from "../../providers/types.js";

export function zeroUsage(): Usage {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            total: 0,
        },
        input: 0,
        output: 0,
        totalTokens: 0,
    };
}
