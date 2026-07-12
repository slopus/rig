import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { inspectGymImage } from "./inspectGymImage.js";

const execFileAsync = promisify(execFile);
const builds = new Map<string, Promise<string>>();

export function buildGymImage(image: string, repositoryRoot: string): Promise<string> {
    let build = builds.get(image);
    if (build === undefined) {
        const pending =
            process.env.RIG_GYM_SKIP_BUILD === "1"
                ? inspectGymImage(image, repositoryRoot)
                : execFileAsync(
                      "docker",
                      [
                          "build",
                          "--quiet",
                          "--file",
                          "packages/gym/Dockerfile",
                          "--tag",
                          image,
                          repositoryRoot,
                      ],
                      { cwd: repositoryRoot, maxBuffer: 100 * 1024 * 1024 },
                  ).then(({ stdout }) => stdout.trim());
        build = pending.catch((error: unknown) => {
            if (builds.get(image) === build) builds.delete(image);
            throw error;
        });
        builds.set(image, build);
    }
    return build;
}
