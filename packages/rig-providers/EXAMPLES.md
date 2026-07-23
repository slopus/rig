# Codex provider examples

Rig does not choose a default Codex model, prompt, skill set, or tool set. Supply them when
creating the session, and supply the model explicitly when running inference.

## Minimal session

```ts
import { CodexProvider, CodexSessionCredential, type SessionMessage } from "@slopus/rig-providers";

const credential = await CodexSessionCredential.tryLoad();
if (credential === null) throw new Error("Sign in with Codex CLI first.");

const provider = new CodexProvider({
    credential,
    transport: "auto", // WebSocket first; native retries use rollback, then may fall back to SSE.
});

const session = await provider.session("thread-123", {
    context: {
        // Root Responses API instructions. This is required and is not a context message.
        instructions: "You are a concise coding agent.",
        messages: [
            // Session `system` messages are sent as developer context.
            { role: "system", content: "Only edit files inside the workspace." },
        ],
    },
    skills: [],
    tools: [],
});

const messages: SessionMessage[] = [{ role: "user", content: "Explain this repository." }];

for await (const event of session.run({
    model: "gpt-5.6-sol",
    effort: "low",
    // Always provide the complete rebuilt transcript. The session detects a shared prefix
    // and sends only the incremental suffix when the Codex WebSocket permits it.
    context: { messages },
})) {
    if (event.type === "text_delta") process.stdout.write(event.delta);
}

session.destroy();
```

Persist assistant messages, tool calls, tool results, opaque response items, and their `vendor`
metadata in the transcript before the next call.

## Reproduce the captured Codex CLI prompt shape

The literal captured assets are exported from `sources/vendors/codex/prompts`, `skills`, and
`tools`. They are session inputs, not hidden provider defaults.

```ts
import {
    apps_instructions,
    codex_agent_instructions,
    CodexProvider,
    exec,
    multi_agent_disabled,
    multi_agent_instructions,
    plugins_instructions,
    read_only_permissions,
    request_user_input,
    wait,
    type SessionModelConfiguration,
} from "@slopus/rig-providers";

const sol: SessionModelConfiguration = {
    context: {
        instructions: codex_agent_instructions,
        messages: [
            {
                role: "system",
                content: [
                    read_only_permissions,
                    apps_instructions,
                    // Present in the captured WebSocket prompt; omit for the SSE capture.
                    plugins_instructions,
                ],
            },
            { role: "system", content: multi_agent_instructions },
            { role: "system", content: multi_agent_disabled },
        ],
    },
    skills: [
        {
            name: "example-skill",
            description: "Use when the user asks for the example workflow.",
            source: "file",
            location: "/absolute/path/to/example-skill/SKILL.md",
        },
    ],
    tools: [exec, wait, request_user_input],
};

const session = await new CodexProvider({
    credential,
    transport: "websocket",
}).session("thread-123", {
    ...sol,
    modelConfigurations: {
        "gpt-5.6-sol": sol,
        // Supply another complete configuration here before switching model families.
    },
});
```

Use `codex_coding_agent_instructions` and the captured GPT-5.5 tool definitions for GPT-5.5.
The exact per-model and per-transport prompt and tool matrices remain test-only; every literal
prompt, skill, and tool they reference is exported by the package.

## Define a Codex-native tool without name-based behavior

Every tool is a normal `SessionTool`. Optional provider metadata selects a native wire definition.
Special tool-call metadata must be persisted with the assistant call and its result.

```ts
import { Type } from "@sinclair/typebox";
import type {
    CodexToolDefinitionVendor,
    CodexToolVendor,
    SessionMessage,
    SessionTool,
} from "@slopus/rig-providers";

const tool_search = {
    name: "tool_search",
    type: "local",
    description: "Find deferred tools.",
    parameters: Type.Object({
        query: Type.String(),
        limit: Type.Optional(Type.Number()),
    }),
    vendor: {
        provider: "codex",
        type: "tool_search",
        execution: "client",
    },
} as const satisfies SessionTool & { readonly vendor: CodexToolDefinitionVendor };

const callVendor = {
    provider: "codex",
    type: "tool_search_call",
    execution: "client",
} as const satisfies CodexToolVendor;

const history: SessionMessage[] = [
    {
        role: "assistant",
        content: "",
        toolCalls: [
            {
                callId: "search-1",
                name: "tool_search",
                arguments: '{"query":"GitHub tools"}',
                vendor: callVendor,
            },
        ],
    },
    {
        role: "tool",
        callId: "search-1",
        content: JSON.stringify([{ type: "function", name: "github_search" }]),
        vendor: callVendor,
    },
];
```

Without that `vendor` value, a tool named `tool_search` is submitted as an ordinary function.

## Native compaction and model switching

The provider never compacts automatically. The outer session manager decides when compaction is
needed, calls `compact()`, persists its complete replacement context, and uses that context on
the next run.

```ts
const compacted = await session.compact();
if (compacted.status !== "completed") throw new Error("Compaction did not complete.");

const nextMessages = [
    ...compacted.context.messages,
    { role: "user" as const, content: "Continue from the compacted context." },
];

for await (const event of session.run({
    model: "gpt-5.6-terra",
    effort: "medium",
    context: { messages: nextMessages },
})) {
    // Consume the stream.
}
```

OpenAI Codex uses native opaque compaction. Bedrock/Mantle uses the provider's local summary
contract. In either case, use `compacted.context` as the complete replacement context.

# Grok provider example

Grok uses the credentials managed by the local Grok CLI, with `XAI_API_KEY` as a fallback.
Only Grok 4.5 is supported.

```ts
import {
    GrokApiKeyCredential,
    GrokProvider,
    GrokSessionCredential,
    type SessionMessage,
} from "@slopus/rig-providers";

const credential =
    (await GrokSessionCredential.tryLoad()) ?? (await GrokApiKeyCredential.tryLoad());
if (credential === null) throw new Error("Sign in with Grok CLI or set XAI_API_KEY.");

const provider = new GrokProvider({
    credential,
    model: "grok-4.5",
});

const session = await provider.session("thread-123", {
    context: {
        instructions: "You are a concise coding agent.",
        messages: [{ role: "system", content: "Only edit files inside the workspace." }],
    },
    tools: [],
});

const messages: SessionMessage[] = [{ role: "user", content: "Explain this repository." }];

for await (const event of session.run({
    effort: "low",
    context: { messages },
})) {
    if (event.type === "text_delta") process.stdout.write(event.delta);
}

const compacted = await session.compact();
if (compacted.status === "completed") {
    // Replace the old context instead of appending the summary to it.
    messages.splice(0, messages.length, ...compacted.context.messages);
}

session.destroy();
```

Persist Grok's assistant messages, tool calls, tool results, encrypted reasoning, and their
`vendor` metadata before the next call. Compaction returns a structural result containing the
summary, encrypted reasoning, preserved messages, usage, and complete replacement context.
