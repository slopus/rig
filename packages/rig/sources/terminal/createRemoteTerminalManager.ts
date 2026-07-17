import { isAbsolute, resolve } from "node:path";
import { posix } from "node:path";

import { DockerEnvironment, type DockerExecutionConfig } from "../execution/index.js";
import { createDockerRemoteTerminalProcessFactory } from "./createDockerRemoteTerminalProcessFactory.js";
import { createNodeRemoteTerminalProcessFactory } from "./createNodeRemoteTerminalProcessFactory.js";
import { RemoteTerminalManager } from "./RemoteTerminalManager.js";

export function createRemoteTerminalManager(options: {
    cwd: string;
    docker?: DockerExecutionConfig;
    sessionId: string;
}): RemoteTerminalManager {
    if (options.docker !== undefined) {
        const environment = new DockerEnvironment(options.docker, options.sessionId);
        return new RemoteTerminalManager({
            cwd: options.docker.workingDirectory,
            processFactory: createDockerRemoteTerminalProcessFactory(environment),
            resolveCwd: (root, requested) =>
                requested === undefined ? root : posix.resolve(root, requested),
        });
    }
    return new RemoteTerminalManager({
        cwd: options.cwd,
        processFactory: createNodeRemoteTerminalProcessFactory(),
        resolveCwd: (root, requested) =>
            requested === undefined
                ? root
                : isAbsolute(requested)
                  ? requested
                  : resolve(root, requested),
    });
}
