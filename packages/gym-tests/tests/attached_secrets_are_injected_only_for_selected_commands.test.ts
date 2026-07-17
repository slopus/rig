import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("attached command secrets", () => {
    it("injects selected bundle IDs while omitted and empty selections inject none", async () => {
        const ambientRegion = "ambient-region-that-must-be-masked";
        const ambientToken = "ambient-token-that-must-be-masked";
        const secretRegion = "gym-region-that-must-not-reach-inference";
        const secretToken = "gym-token-that-must-not-reach-inference";
        const databaseToken = "gym-database-that-must-not-reach-inference";
        const gym = await createGym({
            entrypoint: ["/bin/bash", "/workspace/start-secret-server.sh"],
            environment: {
                INJECTED_SERVICE_REGION: ambientRegion,
                INJECTED_SERVICE_TOKEN: ambientToken,
                INJECTED_DATABASE_TOKEN: "ambient-database-that-must-be-masked",
                RIG_TEST_DATABASE_TOKEN: databaseToken,
                RIG_TEST_REGISTERED_REGION: secretRegion,
                RIG_TEST_REGISTERED_TOKEN: secretToken,
            },
            files: {
                "secret-server.mjs": `
import {
    InMemorySessionStore,
    createModelCatalog,
    createProtocolHttpServer,
} from "/app/packages/rig/dist/server/index.js";

const modelCatalog = createModelCatalog();
const store = new InMemorySessionStore({ modelCatalog });
store.registerSecret({
    description: "Service API credentials",
    environment: {
        INJECTED_SERVICE_REGION: process.env.RIG_TEST_REGISTERED_REGION ?? "",
        INJECTED_SERVICE_TOKEN: process.env.RIG_TEST_REGISTERED_TOKEN ?? "",
    },
    id: "service",
});
store.registerSecret({
    description: "Database credentials",
    environment: {
        INJECTED_DATABASE_TOKEN: process.env.RIG_TEST_DATABASE_TOKEN ?? "",
    },
    id: "database",
});
const create = store.create.bind(store);
store.create = (request) => create({ ...request, secretIds: ["service", "database"] });
const server = createProtocolHttpServer({ modelCatalog, store, token: "secret-test-token" });
server.listen(process.env.RIG_SERVER_SOCKET_PATH);
`,
                "start-secret-server.sh": `#!/usr/bin/env bash
set -euo pipefail
export RIG_SERVER_SOCKET_PATH=/tmp/rig-secret-test.sock
export RIG_SERVER_TOKEN_PATH=/tmp/rig-secret-test.token
printf %s secret-test-token > "$RIG_SERVER_TOKEN_PATH"
node /workspace/secret-server.mjs &
for _ in $(seq 1 200); do
    if [[ -S "$RIG_SERVER_SOCKET_PATH" ]]; then
        exec node /app/packages/rig/dist/main.js
    fi
    sleep 0.05
done
exit 1
`,
            },
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: 'printf "%s|%s|%s" "$INJECTED_SERVICE_TOKEN" "$INJECTED_SERVICE_REGION" "$INJECTED_DATABASE_TOKEN" > with-secrets.txt',
                                secrets: ["service", "database"],
                            },
                            id: "with-secrets",
                            name: "exec_command",
                            type: "toolCall",
                        },
                        {
                            arguments: {
                                cmd: 'test -z "${INJECTED_SERVICE_TOKEN:-}" && test -z "${INJECTED_SERVICE_REGION:-}" && test -z "${INJECTED_DATABASE_TOKEN:-}" && printf absent > secrets-omitted.txt',
                            },
                            id: "secrets-omitted",
                            name: "exec_command",
                            type: "toolCall",
                        },
                        {
                            arguments: {
                                cmd: 'test -z "${INJECTED_SERVICE_TOKEN:-}" && test -z "${INJECTED_SERVICE_REGION:-}" && test -z "${INJECTED_DATABASE_TOKEN:-}" && printf absent > secrets-empty.txt',
                                secrets: [],
                            },
                            id: "secrets-empty",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [{ text: "Secret scope verified.", type: "text" }],
                },
            ],
        });
        running.add(gym);

        gym.terminal.type("Verify the attached service bundle is scoped per command.");
        gym.terminal.press("enter");

        await gym.terminal.waitForText("Secret scope verified.", 30_000);
        await expect(gym.readFile("with-secrets.txt")).resolves.toBe(
            `${secretToken}|${secretRegion}|${databaseToken}`,
        );
        await expect(gym.readFile("secrets-omitted.txt")).resolves.toBe("absent");
        await expect(gym.readFile("secrets-empty.txt")).resolves.toBe("absent");
        expect(JSON.stringify(gym.inference.requests)).not.toContain(secretToken);
        expect(JSON.stringify(gym.inference.requests)).not.toContain(secretRegion);
        expect(JSON.stringify(gym.inference.requests)).not.toContain(databaseToken);
        expect(JSON.stringify(gym.inference.requests)).not.toContain(ambientToken);
        expect(JSON.stringify(gym.inference.requests)).not.toContain(ambientRegion);
    });
});
