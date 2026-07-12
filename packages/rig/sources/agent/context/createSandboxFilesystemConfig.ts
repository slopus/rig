import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { PermissionMode } from "../../permissions/index.js";
import { createSensitiveReadPaths } from "./createSensitiveReadPaths.js";
import { findGitWritablePaths } from "./findGitWritablePaths.js";

export async function createSandboxFilesystemConfig(options: {
    cwd: string;
    environment?: NodeJS.ProcessEnv;
    homeDirectory?: string;
    mode: PermissionMode;
    sandboxConfigDirectory?: string;
    temporaryDirectory?: string;
    uid?: number;
}) {
    const environment = options.environment ?? process.env;
    const homeDirectory = options.homeDirectory ?? homedir();
    const temporaryDirectory = options.temporaryDirectory ?? tmpdir();
    const writablePaths = [temporaryDirectory];
    if (options.mode === "workspace_write" || options.mode === "auto") {
        writablePaths.push(options.cwd);
        writablePaths.push(...(await findGitWritablePaths(options.cwd)));
    }

    const controlDirectory = join(
        temporaryDirectory,
        `rig-${options.uid ?? process.getuid?.() ?? 0}`,
    );
    const denyRead = createSensitiveReadPaths({
        additionalPaths: [options.sandboxConfigDirectory],
        environment,
        homeDirectory,
        temporaryDirectory,
        ...(options.uid === undefined ? {} : { uid: options.uid }),
    });
    const denyWrite = [
        controlDirectory,
        environment.RIG_SERVER_SOCKET_PATH,
        environment.RIG_SERVER_TOKEN_PATH,
        options.sandboxConfigDirectory,
    ].filter(
        (path, index, paths): path is string =>
            typeof path === "string" && path.length > 0 && paths.indexOf(path) === index,
    );

    return {
        denyRead,
        allowRead: [options.cwd],
        allowWrite: writablePaths,
        denyWrite,
    };
}
