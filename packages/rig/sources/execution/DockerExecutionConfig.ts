export interface DockerMountConfig {
    source: string;
    target: string;
    readOnly?: boolean;
}

export interface DockerExecutionConfig {
    container?: string;
    environment?: Readonly<Record<string, string>>;
    image?: string;
    mounts?: readonly DockerMountConfig[];
    name?: string;
    socketPath?: string;
    workingDirectory: string;
}
