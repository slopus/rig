export function isDockerNotFoundError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        error.statusCode === 404
    );
}
