export interface ExecutorEnvironment {
    osVersion: string;
    platform: NodeJS.Platform;
    primaryWorkingDirectory: string;
    shell: string;
}
