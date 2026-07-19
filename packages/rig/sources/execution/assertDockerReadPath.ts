import { posix } from "node:path";

export function assertDockerReadPath(cwd: string, path: string): string {
    return posix.resolve(cwd, path);
}
