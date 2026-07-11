import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const builds = new Map<string, Promise<void>>();

export function buildGymImage(image: string, repositoryRoot: string): Promise<void> {
    if (process.env.RIG_GYM_SKIP_BUILD === "1") return Promise.resolve();
    let build = builds.get(image);
    if (build === undefined) {
        build = execFileAsync(
            "docker",
            ["build", "--file", "packages/gym/Dockerfile", "--tag", image, repositoryRoot],
            { cwd: repositoryRoot, maxBuffer: 100 * 1024 * 1024 },
        ).then(() => undefined);
        builds.set(image, build);
    }
    return build;
}
