import { describe, expect, it } from "vitest";

import { createShellEnvironment } from "./createShellEnvironment.js";

describe("createShellEnvironment", () => {
    it("keeps developer credentials while removing Rig's private control channels", () => {
        const environment = createShellEnvironment({
            ANTHROPIC_AUTH_TOKEN: "anthropic-secret",
            AWS_ACCESS_KEY_ID: "aws-key",
            AWS_SECRET_ACCESS_KEY: "aws-secret",
            CI_JOB_JWT: "ci-secret",
            CLAUDE_CODE_OAUTH_TOKEN: "claude-secret",
            CODEX_HOME: "/secret/codex",
            DATABASE_URL: "postgres://secret.invalid/database",
            DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/501/bus",
            DOCKER_HOST: "unix:///var/run/docker.sock",
            GITHUB_TOKEN: "github-secret",
            GIT_ASKPASS: "/secret/askpass",
            HOME: "/safe/home",
            HTTPS_PROXY: "https://user:secret@proxy.invalid",
            HTTP_PROXY: "http://user:secret@proxy.invalid",
            KUBECONFIG: "/secret/kubeconfig",
            LD_PRELOAD: "/secret/injected-library.so",
            OPENAI_API_KEY: "openai-secret",
            PATH: "/safe/bin",
            PGPASSWORD: "database-secret",
            PROJECT_COOKIE: "cookie-secret",
            PROJECT_PASSWORD: "password-secret",
            PROJECT_PASSPHRASE: "passphrase-secret",
            PROJECT_PRIVATE_KEY: "private-key-secret",
            SIGNING_KEY: "signing-secret",
            RIG_GYM_INFERENCE_URL: "http://control-channel.invalid",
            RIG_GYM_TOKEN: "gym-secret",
            RIG_SERVER_SOCKET_PATH: "/secret/server.sock",
            RIG_SERVER_TOKEN_PATH: "/secret/token",
            SENTRY_DSN: "https://secret.invalid/1",
            SSH_AUTH_SOCK: "/secret/agent.sock",
            XAUTHORITY: "/secret/xauthority",
            database_password: "lowercase-secret",
        });

        expect(environment).toMatchObject({
            AWS_ACCESS_KEY_ID: "aws-key",
            AWS_SECRET_ACCESS_KEY: "aws-secret",
            GITHUB_TOKEN: "github-secret",
            HOME: "/safe/home",
            HTTPS_PROXY: "https://user:secret@proxy.invalid",
            KUBECONFIG: "/secret/kubeconfig",
            OPENAI_API_KEY: "openai-secret",
            PATH: "/safe/bin",
            SSH_AUTH_SOCK: "/secret/agent.sock",
        });
        expect(environment).not.toHaveProperty("RIG_GYM_INFERENCE_URL");
        expect(environment).not.toHaveProperty("RIG_GYM_TOKEN");
        expect(environment).not.toHaveProperty("RIG_SERVER_SOCKET_PATH");
        expect(environment).not.toHaveProperty("RIG_SERVER_TOKEN_PATH");
    });
});
