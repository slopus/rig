const DEFAULT_HAPPY_SERVER_URL = "https://api.cluster-fluster.com";

export function resolveHappyServerUrl(options: {
    environment: NodeJS.ProcessEnv;
    sourceServerUrl?: string;
    targetServerUrl?: string;
}): string {
    const configured =
        options.environment.RIG_HAPPY_SERVER_URL?.trim() ||
        options.environment.HAPPY_SERVER_URL?.trim();
    return (
        configured ||
        options.targetServerUrl ||
        options.sourceServerUrl ||
        DEFAULT_HAPPY_SERVER_URL
    ).replace(/\/+$/u, "");
}
