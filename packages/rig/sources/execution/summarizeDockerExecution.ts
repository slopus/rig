import type { SessionExecutionEnvironment } from "../protocol/SessionProtocol.js";
import type { DockerExecutionConfig } from "./DockerExecutionConfig.js";

export function summarizeDockerExecution(
    config: DockerExecutionConfig | undefined,
): SessionExecutionEnvironment {
    if (config === undefined) return { type: "local" };
    return config.container === undefined
        ? {
              kind: "image",
              reference: config.image ?? "Unknown image",
              type: "docker",
              workingDirectory: config.workingDirectory,
          }
        : {
              kind: "container",
              reference: config.container,
              type: "docker",
              workingDirectory: config.workingDirectory,
          };
}
