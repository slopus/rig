import type { Usage } from "../../providers/types.js";

export function addUsage(left: Usage, right: Usage): Usage {
    return {
        cacheRead: left.cacheRead + right.cacheRead,
        cacheWrite: left.cacheWrite + right.cacheWrite,
        cost: {
            cacheRead: left.cost.cacheRead + right.cost.cacheRead,
            cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
            input: left.cost.input + right.cost.input,
            output: left.cost.output + right.cost.output,
            total: left.cost.total + right.cost.total,
        },
        input: left.input + right.input,
        output: left.output + right.output,
        totalTokens: left.totalTokens + right.totalTokens,
    };
}
