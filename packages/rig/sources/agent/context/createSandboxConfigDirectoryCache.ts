export function createSandboxConfigDirectoryCache(
    createDirectory: () => Promise<string>,
): () => Promise<string> {
    let pending: Promise<string> | undefined;

    return async () => {
        pending ??= createDirectory();
        try {
            return await pending;
        } catch (error) {
            pending = undefined;
            throw error;
        }
    };
}
