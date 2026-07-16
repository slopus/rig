import { writeFile } from "node:fs/promises";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
    { name: "rig-client-identity-test", version: "1.0.0" },
    { capabilities: {} },
);

server.oninitialized = () => writeFile(process.argv[2], JSON.stringify(server.getClientVersion()));

await server.connect(new StdioServerTransport());
