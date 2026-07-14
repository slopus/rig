import { isAbsolute, resolve } from "node:path";

import type { DockerExecutionConfig } from "./DockerExecutionConfig.js";

export function resolveDockerExecutionConfig(
    config: DockerExecutionConfig,
    hostCwd: string,
): DockerExecutionConfig {
    return {
        ...config,
        ...(config.mounts === undefined
            ? {}
            : {
                  mounts: config.mounts.map((mount) => ({
                      ...mount,
                      source: isAbsolute(mount.source)
                          ? mount.source
                          : resolve(hostCwd, mount.source),
                  })),
              }),
    };
}
