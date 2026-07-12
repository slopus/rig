export function createShellEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(environment).filter(
            ([name, value]) => value !== undefined && !name.toUpperCase().startsWith("RIG_"),
        ),
    );
}
