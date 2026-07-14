import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export function createSensitiveReadPaths(
    options: {
        additionalPaths?: readonly (string | undefined)[];
        environment?: NodeJS.ProcessEnv;
        homeDirectory?: string;
        temporaryDirectory?: string;
        uid?: number;
    } = {},
): readonly string[] {
    const environment = options.environment ?? process.env;
    const homeDirectory = options.homeDirectory ?? homedir();
    const temporaryDirectory = options.temporaryDirectory ?? tmpdir();
    const configuredDirectory = environment.XDG_CONFIG_HOME;
    const configDirectory =
        configuredDirectory && isAbsolute(configuredDirectory)
            ? configuredDirectory
            : join(homeDirectory, ".config");
    return [
        homeDirectory,
        join(homeDirectory, ".aws"),
        join(homeDirectory, ".azure"),
        join(homeDirectory, ".bash_history"),
        join(homeDirectory, ".claude"),
        join(homeDirectory, ".codex"),
        join(homeDirectory, ".docker"),
        join(homeDirectory, ".env"),
        join(homeDirectory, ".git-credentials"),
        join(homeDirectory, ".gnupg"),
        join(homeDirectory, ".kube"),
        join(homeDirectory, ".netrc"),
        join(homeDirectory, ".node_repl_history"),
        join(homeDirectory, ".npmrc"),
        join(homeDirectory, ".password-store"),
        join(homeDirectory, ".psql_history"),
        join(homeDirectory, ".pypirc"),
        join(homeDirectory, ".python_history"),
        join(homeDirectory, ".ssh"),
        join(homeDirectory, ".zsh_history"),
        join(homeDirectory, "Library", "Keychains"),
        join(homeDirectory, ".local", "share", "keyrings"),
        join(configDirectory, "1Password"),
        join(configDirectory, "gcloud"),
        join(configDirectory, "gh"),
        join(configDirectory, "glab-cli"),
        join(configDirectory, "op"),
        join(temporaryDirectory, `rig-${options.uid ?? process.getuid?.() ?? 0}`),
        environment.AWS_CONFIG_FILE,
        environment.AWS_SHARED_CREDENTIALS_FILE,
        environment.CLAUDE_CONFIG_DIR,
        environment.CODEX_HOME,
        environment.DOCKER_CONFIG,
        environment.GIT_CONFIG_GLOBAL,
        environment.GNUPGHOME,
        environment.KUBECONFIG,
        environment.NETRC,
        environment.NPM_CONFIG_USERCONFIG,
        environment.RIG_SERVER_DIRECTORY,
        environment.RIG_SERVER_SOCKET_PATH,
        environment.RIG_SERVER_TOKEN_PATH,
        ...(options.additionalPaths ?? []),
    ].filter(
        (path, index, paths): path is string =>
            typeof path === "string" && path.length > 0 && paths.indexOf(path) === index,
    );
}
