# Rig gym

The Rig gym is the end-to-end test harness for the complete terminal agent experience. It runs the built Rig CLI inside a fresh Docker container, drives it through a real pseudo-terminal, supplies deterministic model responses from the host, and interprets terminal output with `libghostty-vt`.

The goal is to test the product at the same boundary a user experiences while keeping model behavior deterministic. A gym test can exercise terminal rendering, multiline input, tool calls, real processes, filesystem changes, interactive questions, interruptions, provider failures, and concurrency without calling a live model.

## Core principles

1. **Every instance is isolated.** Each call to `createGym` creates a unique fixture directory, inference server, Docker container, PTY, and terminal emulator.
2. **Always use Docker.** There is no in-process shell or reduced-fidelity fallback. Tests run the built agent in a new container even when the scenario looks simple.
3. **Mock only inference.** Model responses are scripted by the test. The CLI, daemon, agent loop, tools, shell, filesystem, process management, HTTP transport, and rendering code are real.
4. **Interact like a user.** Drive behavior through terminal input and assert the terminal screen or resulting observable state. Avoid calling application internals to move a scenario forward.
5. **Wait for state, not time.** Use terminal predicates and explicit timeouts instead of fixed sleeps.
6. **Make failures explain the product.** Prefer assertions on visible text, inference requests, files, process effects, and viewport state over implementation details.
7. **Reproduce before fixing.** For a regression, first demonstrate the failure against the unfixed image. Then fix production code and run the same test unchanged.

## What is real and what is mocked

| Part                      | Behavior in the gym                                            |
| ------------------------- | -------------------------------------------------------------- |
| Rig CLI and daemon        | Built from the repository and run inside Docker                |
| Agent loop                | Real                                                           |
| Tool dispatch             | Real                                                           |
| Shell and child processes | Real processes inside the container                            |
| Filesystem                | Real temporary workspace bind-mounted at `/workspace`          |
| Terminal input            | Real PTY input sent through `node-pty`                         |
| Terminal output           | Real PTY output interpreted by `libghostty-vt`                 |
| Model/provider inference  | Mocked by a test-owned HTTP server on the host                 |
| Provider transport        | Real authenticated HTTP request from the container to the host |
| Credentials               | Not used; the gym provider is selected explicitly              |

The host controls model inference and terminal input. It does not replace shell commands, tools, filesystem APIs, or process execution with test doubles.

## Architecture

```text
Vitest scenario on the host
    │
    ├── MockInferenceServer ───── scripted HTTP responses
    │          ▲
    │          │ authenticated inference requests
    │          │
    ├── node-pty ─────────────── docker run --interactive --tty
    │          │                         │
    │          │ keystrokes              ├── built Rig CLI and daemon
    │          │                         ├── real agent loop and tools
    │          │ PTY output              ├── bash and child processes
    │          ▼                         └── /workspace bind mount
    └── libghostty-vt helper
               └── visible rows, cursor, title, scrollback, viewport offset
```

`createGym` performs the following lifecycle:

1. Creates a unique temporary workspace and writes fixture files.
2. Starts a token-protected mock inference HTTP server on an ephemeral host port.
3. Builds the default Docker image once per host test process unless image building is skipped.
4. Starts a persistent `libghostty-vt` helper for the requested terminal dimensions.
5. Runs the container through `node-pty` with a unique name and the workspace mounted at `/workspace`.
6. Configures Rig to use the `gym` provider, `openai/gym` model, and full-access permissions.
7. Feeds every PTY output chunk into the Ghostty terminal state.
8. Waits until the Rig composer is visible before returning the `Gym` instance.
9. On disposal, kills the PTY, force-removes the container, closes the terminal helper and inference server, and deletes the temporary workspace.

Restricted-command scenarios run Sandbox Runtime inside the disposable Gym container. Gym removes Docker's seccomp filter so Bubblewrap can create nested user and PID namespaces, but adds no host capabilities; `RIG_GYM_OUTER_ISOLATION=docker` enables Sandbox Runtime's documented nested-container mode only when `/.dockerenv` is also present. The outer unprivileged container and its temporary workspace remain the host boundary.

## Repository layout

```text
packages/gym/
├── Dockerfile                 Builds the production-like Rig image
├── sources/                   Host runner, PTY, fixtures, and inference server
└── terminal/                  Rust libghostty-vt helper

packages/gym-tests/
├── README.md                  This guide
├── package.json               End-to-end test scripts
├── tsconfig.json
└── tests/                     All end-to-end gym scenarios

packages/rig/sources/providers/
├── createGymProvider.ts       Container-side provider transport
└── gym-types.ts               Shared inference protocol
```

All end-to-end scenarios belong directly in `packages/gym-tests/tests`. Unit
tests for the host runner or terminal helper belong beside their source in
`packages/gym/sources`.

## Prerequisites

Running the gym requires:

- Docker with a working Linux container runtime.
- `pnpm`, using the version configured by the repository.
- Rust and Cargo, used to build the host-side `libghostty-vt` helper.
- A supported `node-pty` environment.

No Codex, Claude, OpenAI, or Anthropic credentials are required. The container always uses the local gym provider.

## Running tests

### Complete suite

From the repository root:

```sh
pnpm test:gym
```

This builds `rig-gym:local` and then runs every file in `packages/gym-tests/tests`. Docker caches image layers, and the test process reuses the completed image build across gym instances.

### Targeted iteration

Build the image once:

```sh
pnpm build:gym
```

Then run one descriptive test file without rebuilding:

```sh
RIG_GYM_SKIP_BUILD=1 pnpm --filter @slopus/rig-gym-tests exec vitest run \
  tests/agent_edits_fixture_with_real_shell.test.ts
```

Run all gym tests against the existing image with:

```sh
RIG_GYM_SKIP_BUILD=1 pnpm --filter @slopus/rig-gym-tests test:gym
```

Set `RIG_GYM_IMAGE` to use a uniquely tagged image when other workspaces or agents may build Gym
at the same time. This avoids another build replacing the shared `rig-gym:local` tag during a run:

```sh
RIG_GYM_IMAGE=rig-gym:my-workspace RIG_GYM_SKIP_BUILD=1 \
  pnpm --filter @slopus/rig-gym-tests test:gym
```

Rebuild the Docker image whenever production Rig code, package dependencies, or `packages/gym/Dockerfile` changes. Changes limited to `packages/gym-tests/tests`, the host runner in `packages/gym/sources`, or the Rust terminal helper do not require an image rebuild. The Rust helper is compiled on the host when the gym starts.

## Naming and organizing scenarios

Use a file name that states the behavior being proven. The test directory should read like an index of supported workflows.

Good names:

- `agent_edits_fixture_with_real_shell.test.ts`
- `user_answers_agent_question_in_terminal.test.ts`
- `parallel_gym_instances_are_isolated.test.ts`
- `large_multiline_unicode_message_renders_without_corruption.test.ts`

Avoid names such as `agent.test.ts`, `integration.test.ts`, `scenario_3.test.ts`, or issue numbers without a behavior description.

Keep one coherent end-to-end behavior per file. Shared assertion helpers may stay in the test file when they describe that behavior. If a helper becomes generally useful, move it into `packages/gym/sources` and give it focused unit coverage.

## Basic test structure

```ts
import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("agent edits a fixture with the real shell", () => {
    it("writes the result inside its Docker workspace", async () => {
        const gym = await createGym({
            files: { "input.txt": "hello\n" },
            inference: [
                {
                    content: [
                        {
                            arguments: { cmd: "cp input.txt output.txt" },
                            id: "call-1",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Done.", type: "text" }] },
            ],
        });
        running.add(gym);

        gym.terminal.type("Copy the input file.");
        gym.terminal.press("enter");

        const screen = await gym.terminal.waitForText("Done.");
        expect(screen.text).toContain("Done.");
        await expect(gym.readFile("output.txt")).resolves.toBe("hello\n");
    });
});
```

Register the gym for cleanup immediately after creation. An alternative is a `try`/`finally` block around a single instance:

```ts
const gym = await createGym(options);
try {
    // Scenario and assertions.
} finally {
    await gym.dispose();
}
```

Cleanup must run when assertions fail. Leaked containers, servers, or fixture directories make later tests unreliable.

## `createGym` options

```ts
interface GymOptions {
    args?: readonly string[];
    cols?: number;
    contextWindow?: number;
    dockerSocket?: boolean;
    entrypoint?: readonly [string, ...string[]];
    environment?: Readonly<Record<string, string>>;
    files?: Readonly<Record<string, GymFixture>>;
    homeFiles?: Readonly<Record<string, GymFixture>>;
    httpProxy?: true | { handler?: HttpInterceptHandler };
    image?: string;
    inference?: readonly GymMockResponse[] | GymInferenceHandler;
    modelId?: string;
    permissionMode?: "auto" | "from_config" | "full_access" | "read_only" | "workspace_write";
    providerId?: "bedrock" | "claude" | "codex" | "gym";
    providerOverrides?: readonly ("claude" | "codex")[];
    rows?: number;
    startupText?: string;
    terminalColorScheme?: "dark" | "light";
    timeoutMs?: number;
}
```

| Option                | Default                  | Purpose                                                                   |
| --------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `args`                | `[]`                     | Arguments passed to the built Rig CLI                                     |
| `cols`                | `100`                    | Terminal width in cells                                                   |
| `contextWindow`       | Provider default         | Overrides the context window for gym-backed inference                     |
| `dockerSocket`        | `false`                  | Exposes the daemon socket for Docker tests                                |
| `entrypoint`          | Image default            | Replaces the image entrypoint for setup cases                             |
| `environment`         | `{}`                     | Extra environment variables inside the container                          |
| `files`               | `{}`                     | Fixture tree mounted into `/workspace`                                    |
| `homeFiles`           | `{}`                     | Trusted fixture tree mounted into `/home/rig`                             |
| `httpProxy`           | Disabled                 | Record, replace, rewrite, or forward provider HTTP                        |
| `image`               | `rig-gym:local`          | Docker image tag to build or run                                          |
| `inference`           | `[]`                     | Ordered gym-provider responses or a request handler                       |
| `modelId`             | Provider default         | Model selected for the session                                            |
| `permissionMode`      | `full_access`            | Permission mode, or `from_config` to leave the environment unset          |
| `providerId`          | `gym`                    | `gym` or the deployed `bedrock`, `claude`, or `codex` provider            |
| `providerOverrides`   | `[]`                     | Routes selected Claude or Codex providers through deterministic inference |
| `rows`                | `32`                     | Terminal height in cells                                                  |
| `startupText`         | `Ask Rig to do anything` | Visible text that marks startup as complete                               |
| `terminalColorScheme` | `dark`                   | Initial terminal color scheme used by the Ghostty interpreter             |
| `timeoutMs`           | `20_000`                 | Maximum startup wait for the composer                                     |

Set `startupText` to a stable visible fragment only when a deliberately narrow startup viewport
truncates the default placeholder.

Use explicit `cols` and `rows` when layout, wrapping, resize behavior, or cursor placement matters. Otherwise prefer the defaults.

## Fixture filesystem

Fixture keys are paths relative to `/workspace`. Parent directories are created automatically.

```ts
const gym = await createGym({
    files: {
        "README.md": "fixture repository\n",
        "src/input.ts": "export const input = 42;\n",
        "scripts/run.sh": {
            content: "#!/usr/bin/env bash\necho ready\n",
            mode: 0o755,
        },
        "binary.dat": new Uint8Array([0, 1, 2, 3]),
    },
    inference,
});
```

A fixture may be:

- A UTF-8 string.
- A `Uint8Array` for binary content.
- `{ content, mode }` when permissions matter.

Absolute paths and paths that escape `/workspace` are rejected. The host fixture directory is bind-mounted, so changes made by real container processes are visible through `gym.readFile`:

```ts
await expect(gym.readFile("src/result.txt")).resolves.toBe("created in Docker\n");
```

`gym.workspacePath` exposes the temporary host path for advanced diagnostics. Prefer `gym.readFile` in assertions so tests remain clear and path-safe.

Use `homeFiles` for configuration that must originate from the simulated user's trusted home
directory, such as `.rig/config.toml`. Its keys are relative to `/home/rig`. Keep
repository-controlled fixtures in `files` so security tests preserve the source boundary.

For provider-boundary tests that need to compare Rig with a directly invoked SDK in the same
deployed image, `gym.runInContainer(command, args, options)` runs a command in `/workspace` and
returns its standard output and error. Keep normal product scenarios at the terminal boundary;
this helper is intended for controlled companion processes such as a vanilla provider SDK probe.

## Mock inference

The inference server is the only intentional test double. Rig still makes a real authenticated HTTP request from the container to the host for every model call.

### Ordered responses

Use an array when the conversation is fixed:

```ts
const inference = [
    { content: [{ text: "I will inspect the file.", type: "text" }] },
    {
        content: [
            {
                arguments: { cmd: "cat input.txt" },
                id: "call-1",
                name: "exec_command",
                type: "toolCall",
            },
        ],
    },
    { content: [{ text: "The file contains hello.", type: "text" }] },
];
```

Each non-title agent call consumes one entry. If the agent makes more calls than the script provides, the server returns an explanatory HTTP 500 error.

Session-metadata requests are answered automatically with a `Gym session` title and short recap. They are recorded in `gym.inference.requests`, but they do not consume an ordered response or increment the handler's `callIndex`.

### Request handler

Use a handler when the response depends on the prompt, tool result, previous turn, or call number:

```ts
inference(request, callIndex) {
    const lastMessage = request.context.messages.at(-1);

    if (callIndex === 0) {
        expect(lastMessage).toMatchObject({ role: "user" });
        return {
            content: [
                {
                    arguments: { cmd: "printf 'done\\n' > result.txt" },
                    id: "write-result",
                    name: "exec_command",
                    type: "toolCall",
                },
            ],
        };
    }

    expect(lastMessage).toMatchObject({
        isError: false,
        role: "toolResult",
        toolName: "exec_command",
    });
    return { content: [{ text: "Finished.", type: "text" }] };
}
```

The handler may be asynchronous. `callIndex` starts at zero and excludes automatic title requests.

### Response fields

Normal responses support:

```ts
interface GymInferenceResponse {
    content: readonly AssistantContent[];
    completionDelayMs?: number;
    delayMs?: number;
    errorMessage?: string;
    responseModel?: string;
    stopReason?: StopReason;
    thinkingDeltaChunkSize?: number;
    thinkingDeltaDelayMs?: number;
    textDeltaChunkSize?: number;
    textDeltaDelayMs?: number;
    toolCallDeltaDelayMs?: number;
    usage?: Usage;
}
```

- `content` may contain text, thinking, or tool-call blocks accepted by Rig's provider types.
- `completionDelayMs` delays the final provider result after content has streamed. It intentionally
  continues through cancellation so tests can reproduce a completion already in flight.
- `delayMs` delays the response inside the container-side provider and respects abort signals. Use it for interruption and concurrency scenarios.
- `thinkingDeltaChunkSize` splits thinking blocks into deterministic streaming deltas of at most that many UTF-16 code units.
- `thinkingDeltaDelayMs` pauses between thinking deltas and respects abort signals. Pair it with `thinkingDeltaChunkSize` for live reasoning-stream scenarios.
- `textDeltaChunkSize` splits text blocks into deterministic streaming deltas of at most that many UTF-16 code units.
- `textDeltaDelayMs` pauses between those text deltas and respects abort signals. Pair it with `textDeltaChunkSize` for live text-stream rendering scenarios.
- `toolCallDeltaDelayMs` pauses after `toolcall_start` and before the arguments delta. Use it to exercise the live streamed-tool-call UI deterministically.
- `stopReason` defaults to `toolUse` when any content block is a tool call, otherwise `stop`.
- `errorMessage` populates the assistant message error field.
- `responseModel` simulates a provider reporting a different concrete model.
- `usage` supplies token and cost accounting. Omitted usage is zeroed.

### HTTP failures

Return an HTTP response object to test provider failures:

```ts
const inference = [{ body: "scripted overload", httpStatus: 429 }];
```

The real gym provider converts the non-success response into the same visible error path used for provider transport failures.

Return `{ disconnect: true }` to destroy the response socket without sending an HTTP response. This
reproduces a low-level inference transport failure for retry and recovery scenarios.

### Inspecting requests

Every received payload is retained in `gym.inference.requests`:

```ts
const agentRequests = gym.inference.requests.filter(
    (request) => !request.options.sessionId?.endsWith(":title"),
);

expect(agentRequests[1]?.context.messages.at(-1)).toMatchObject({
    isError: false,
    role: "toolResult",
    toolName: "exec_command",
});
```

Use request assertions to verify exact user text, normalized paste content, tool results, conversation ordering, stream options, or selected model behavior.

## Intercepting provider HTTP

Set `providerId` to run the deployed Amazon Bedrock, Claude Agent SDK, or Codex provider instead of
the deterministic gym provider. Adding `httpProxy` starts a test-owned proxy on the host and sets `HTTP_PROXY`,
`HTTPS_PROXY`, `http_proxy`, and `https_proxy` inside the container. Every observed exchange is
available through `gym.httpProxy.exchanges`. The gym also enables Node's environment-proxy support
so the Codex provider's `fetch` transport uses these variables.

```ts
const gym = await createGym({
    providerId: "claude",
    modelId: "anthropic/sonnet-4-6",
    environment: {
        ANTHROPIC_API_KEY: "test-only-placeholder",
        ANTHROPIC_BASE_URL: "http://api.anthropic.test",
    },
    httpProxy: {
        handler(request) {
            if (new URL(request.url).pathname === "/v1/messages") {
                return {
                    response: {
                        status: 200,
                        headers: { "content-type": "text/event-stream" },
                        body: scriptedAnthropicEvents,
                    },
                };
            }
        },
    },
});
```

The interceptor may return:

- `response` to replace the provider response without contacting the target.
- `request` to replace the URL, method, headers, or body before forwarding upstream.
- `transformResponse` to inspect and optionally replace a forwarded upstream response.
- `undefined` to passively forward and record the request and response unchanged.

Plain HTTP requests expose their complete headers and bodies. Standard HTTPS proxying uses
`CONNECT`, so passive capture can record the destination and connection result but not encrypted
payloads. Use a controlled HTTP provider base URL, as above, when a test needs to inspect or replace
the exact JSON request without installing a test certificate authority. Never route real credentials
through a response-replacing gym.

Some native clients tunnel even plain HTTP proxy traffic with `CONNECT`. To route a controlled
provider endpoint directly to the interceptor in those tests, use `{{HTTP_PROXY_URL}}` in an
environment value and exempt `host.docker.internal` from proxying:

```ts
environment: {
    NO_PROXY: "host.docker.internal",
    RIG_CODEX_BASE_URL: "{{HTTP_PROXY_URL}}/backend-api",
}
```

`createGym` replaces the placeholder after the interceptor starts, before launching the container.

## Terminal interaction

The terminal API operates at the external user/emulator boundary.

### Typing and keys

```ts
gym.terminal.type("Explain this repository.");
gym.terminal.press("enter");
```

`type(text)` writes the text directly to the PTY as raw typing. This is important for detecting input chunking and redraw bugs.

`paste(text)` wraps the text in bracketed-paste markers before writing it. Use it only when the scenario is specifically about a terminal paste. Do not replace `type` with `paste` merely to make a failing raw-input test pass.

`press(key)` supports:

- `backspace`
- `ctrlC`
- `ctrlD`
- `down`
- `enter`
- `escape`
- `left`
- `right`
- `tab`
- `up`

`write(data)` sends arbitrary bytes represented as a string. Reserve it for deliberate low-level VT or keyboard-sequence tests; ordinary scenarios should use `type`, `paste`, and `press`.

### Resize

```ts
gym.terminal.resize(80, 24);
```

Resize updates both the host PTY and Ghostty's emulated terminal. Use it to test wrapping, reflow, compact layouts, or resize-related rendering regressions.

### Waiting for visible state

```ts
const screen = await gym.terminal.waitForText("Finished.", 30_000);
```

`waitForText(text, timeoutMs?)` polls snapshots until visible terminal text contains the requested value. Its default timeout is 10 seconds.

For richer conditions, use `waitUntil`:

```ts
const screen = await gym.terminal.waitUntil(
    (snapshot) => snapshot.text.includes("Ready") && snapshot.scroll.atBottom,
    "ready state at the bottom of the viewport",
    30_000,
);
```

On timeout, the error includes the last visible terminal snapshot. Do not replace these waits with `setTimeout` or fixed sleeps. Fixed delays are slow on fast machines and flaky on slow ones.

### Snapshots

```ts
type TerminalColorSnapshot =
    | { kind: "palette"; index: number }
    | { kind: "rgb"; red: number; green: number; blue: number };

interface TerminalCellSnapshot {
    background: TerminalColorSnapshot | null;
    bold: boolean;
    dim: boolean;
    foreground: TerminalColorSnapshot | null;
    italic: boolean;
    text: string;
    x: number;
    y: number;
}

interface TerminalSnapshot {
    cells: readonly TerminalCellSnapshot[];
    cursor: {
        visible: boolean;
        x: number;
        y: number;
    };
    defaultBackground: TerminalColorSnapshot;
    defaultForeground: TerminalColorSnapshot;
    outputRevision: number;
    rows: readonly string[];
    scroll: {
        atBottom: boolean;
        atTop: boolean;
        bottomDepartureCount: number;
        offset: number;
        topArrivalCount: number;
        totalRows: number;
        visibleRows: number;
    };
    synchronizedOutputActive: boolean;
    text: string;
    title: string;
}
```

- `cells` exposes coordinates, text, colors, and styles for exact visual assertions.
- `rows` contains exactly the visible terminal rows, with trailing spaces removed from each row.
- `text` joins visible rows with newlines and trims empty space at the end of the screen.
- `cursor` reports the terminal cursor position and visibility.
- `defaultBackground` and `defaultForeground` report the terminal's effective default colors.
- `outputRevision` identifies the latest PTY output included when the snapshot was requested.
- `synchronizedOutputActive` reports whether synchronized-output mode is active.
- `title` is the latest title set through terminal escape sequences.
- `scroll` reports scrollback and visible viewport state.

Snapshots represent interpreted terminal state, not raw ANSI output. This lets tests assert what a user would see without implementing their own escape-sequence parser.

## Scrollback and viewport tracking

The Ghostty helper keeps up to 10,000 scrollback rows. It exposes the scrollbar values maintained by `libghostty-vt`:

- `totalRows`: total rows in the scrollable area, including visible rows.
- `visibleRows`: length of the visible viewport.
- `offset`: zero-based viewport offset into the total scrollable area.
- `atBottom`: true when `offset + visibleRows >= totalRows`.
- `atTop`: true when scrollback exists and `offset === 0`. A terminal with no scrollback is not treated as having arrived at the top.

The helper also maintains cumulative transition counters:

- `bottomDepartureCount` increments whenever the viewport changes from bottom to not-bottom.
- `topArrivalCount` increments whenever the viewport changes from not-top to top while scrollback exists.

The counters are observed after each PTY output chunk and after explicit resize or scroll commands. They never reset when a snapshot is read. This matters because `waitForText` takes repeated snapshots: polling cannot consume and hide a previously observed jump.

### Detecting an unintended jump

Take a baseline before the interaction and compare it afterward:

```ts
const baseline = (await gym.terminal.snapshot()).scroll;

gym.terminal.type(largeMessage);
const screen = await gym.terminal.waitForText("[paste #", 30_000);

expect(screen.scroll.atBottom).toBe(true);
expect(screen.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
expect(screen.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
```

This catches both a persistent wrong offset and an observed top jump that later returned to the bottom.

For rendering regressions, also verify screen health. Scroll counters alone do not detect content corruption that occurs while the emulator remains at the bottom:

```ts
expect(screen.rows).toHaveLength(34);
expect(screen.text).toContain("Ask Rig to do anything");
expect(screen.text).toContain("Gym Off • /workspace");
expect(screen.text).not.toContain("\x1b[200~");
expect(screen.text).not.toContain("\x1b[201~");
expect(screen.text).not.toContain("�");
```

Follow the first turn with a second input when possible. A terminal may look correct at one instant but remain unable to accept or render subsequent interaction.

### Simulating emulator-side scrolling

```ts
gym.terminal.scrollToTop();
gym.terminal.scrollBy(5);
gym.terminal.scrollToBottom();
```

These methods manipulate the `libghostty-vt` viewport. They simulate a user scrolling the terminal emulator; they do not send Page Up, mouse-wheel, or keyboard bytes to Rig. A later snapshot is ordered after the scroll command, so no separate delay is needed.

For `scrollBy`, positive values move down toward live output and negative values move up into history.

Use them to test behavior such as output arriving while the user reads history, preserving viewport position, returning to live output, or detecting unexpected scroll resets.

### Scroll-tracking limits

The gym models terminal state, not the native window chrome of every terminal application. It does not automatically reproduce platform-specific scrollbar widgets, touchpad gestures, selection state, or terminal-application preferences.

Transition counters observe state after each PTY output chunk. If multiple viewport transitions occur entirely inside one chunk and finish at the original offset, only the final state of that chunk is observable. Persistent jumps and transitions spanning normal PTY chunks are tracked directly.

## Parallel and concurrency scenarios

Each gym owns independent state, so a test may start multiple instances concurrently:

```ts
const [alpha, beta] = await Promise.all([
    createGym({ inference: [{ content: [{ text: "alpha", type: "text" }] }] }),
    createGym({ inference: [{ content: [{ text: "beta", type: "text" }] }] }),
]);
```

Never share inference scripts, mutable fixture state, terminal assumptions, or execution ordering between instances. Dispose all instances even when one startup or assertion fails.

The default gym test command currently runs test files without file-level parallelism for predictable resource use. Isolation must still be preserved because individual scenarios test concurrency and the runner may enable broader parallelism in the future.

## Custom images

`image` selects the Docker tag used by a gym:

```ts
const gym = await createGym({
    image: "rig-gym-with-extra-tools:local",
    inference,
});
```

Without `RIG_GYM_SKIP_BUILD=1`, the runner builds the repository's standard `packages/gym/Dockerfile` under that tag. To use an externally prepared image with additional system dependencies, build it first, ensure it preserves the standard image's entrypoint and `/workspace` behavior, then run the test with image building skipped.

Prefer the standard image. Add a custom image only when the behavior genuinely depends on another system package or environment characteristic.

## Choosing gym tests versus unit tests

Use a gym test when the risk lies in integration between real boundaries:

- PTY input chunking, special keys, paste, cursor behavior, or rendering.
- Agent/provider/tool conversation flow.
- Real shell commands, process groups, signals, or concurrency.
- Container filesystem changes or executable permissions.
- Interactive prompts and user responses.
- Provider HTTP failures, delays, aborts, or malformed model behavior.
- Terminal scrollback, viewport offsets, or resize/reflow.

Use a focused unit test when one function or class can be exercised accurately without Docker. A production fix should often have both: a gym regression proving the user-visible failure and a unit test precisely covering the corrected logic.

Avoid gym tests that merely repeat a unit test at much higher cost without validating an integration boundary.

## Regression workflow

When fixing a user-visible integration bug:

1. Add a descriptively named test under `packages/gym-tests/tests`.
2. Build the current, unfixed production image.
3. Run only the new test and confirm it fails for the expected reason.
4. Record enough evidence to distinguish the real reproduction from a broken test setup.
5. Implement the production fix without weakening the test or changing the interaction to a different path.
6. Rebuild the image.
7. Run the same test unchanged and confirm it passes.
8. Add focused unit coverage when the root cause has a useful isolated contract.
9. Run the complete gym suite and the repository's normal checks.

For example, if raw multiline input is corrupt but bracketed paste works, keep the regression on `terminal.type`. Changing it to `terminal.paste` would avoid the failing path instead of proving the fix.

## Assertion guidance

A strong gym test usually checks more than a final sentence. Depending on the behavior, assert several layers:

- **Visible result:** the user-facing terminal text or prompt appears.
- **Terminal health:** footer, cursor, row count, escape-sequence hygiene, and viewport state remain valid.
- **Inference contract:** the model request contains exact user text, tool results, or conversation ordering.
- **System effect:** expected files or process outputs exist inside the real workspace.
- **Continued usability:** a subsequent turn, keypress, or tool call still works.

Do not assert large complete snapshots when a few stable semantic assertions are enough. Full-screen snapshots tend to break on harmless copy or layout changes. Conversely, do not assert only the mocked final response when the test is intended to prove rendering or tool behavior.

## Debugging failures

### Inspect the last screen

`waitForText` and `waitUntil` include the last visible terminal text in timeout errors. You can also capture the full structured state:

```ts
const snapshot = await gym.terminal.snapshot();
console.error(JSON.stringify(snapshot, null, 2));
```

Inspect `rows`, cursor coordinates, title, offset, and transition counters together. A missing string may be in scrollback rather than the visible viewport, or the terminal may have left the bottom.

### Inspect inference history

```ts
console.error(JSON.stringify(gym.inference.requests, null, 2));
```

If a tool response appears to be missing, verify whether the next model request contains the expected `toolResult`. Remember that automatic title requests are present in this array.

### Inspect files before cleanup

Use `gym.readFile` for expected outputs. During local diagnosis, `gym.workspacePath` identifies the temporary host directory while the gym is alive. Disposal removes it.

### Check the image

If production changes do not appear in the container, rebuild with `pnpm build:gym`. `RIG_GYM_SKIP_BUILD=1` deliberately uses the existing image and can otherwise make a fixed source tree look unfixed.

### Check for leaked containers

Gym containers use unique names prefixed with `rig-gym-`. Normal cleanup removes them. If a test process is killed abruptly, inspect Docker for leftovers and remove them before interpreting isolation failures.

### Keep failure injection explicit

Use scripted HTTP status responses, delayed inference, malformed content, or exact model outputs to reproduce inference bugs. Avoid random timing when a deterministic delay or response sequence can express the same condition.

## Common mistakes

- Running Rig directly on the host instead of using `createGym`.
- Mocking shell commands, tools, or filesystem operations that the gym is meant to integrate.
- Using `paste` when the bug concerns raw typing, or `type` when the behavior specifically concerns bracketed paste.
- Sleeping for a fixed duration instead of waiting for visible state.
- Forgetting to register a gym for cleanup before the first assertion.
- Reusing a mutable inference response array across instances.
- Depending on test file execution order.
- Reading raw PTY ANSI data instead of asserting the Ghostty snapshot.
- Checking only final text for a rendering regression while ignoring cursor, footer, rows, and scroll state.
- Comparing transition counters to zero instead of to a baseline; startup behavior may legitimately evolve.
- Forgetting to rebuild the image after changing production code.
- Weakening a regression test after it exposes a real bug.

## Existing examples

The current tests provide focused references:

- [`agent_edits_fixture_with_real_shell.test.ts`](tests/agent_edits_fixture_with_real_shell.test.ts) demonstrates fixtures, real shell tools, filesystem assertions, and inference history.
- [`user_answers_agent_question_in_terminal.test.ts`](tests/user_answers_agent_question_in_terminal.test.ts) demonstrates interactive user input and tool-result verification.
- [`inference_http_error_is_visible.test.ts`](tests/inference_http_error_is_visible.test.ts) demonstrates provider HTTP failure injection.
- [`parallel_gym_instances_are_isolated.test.ts`](tests/parallel_gym_instances_are_isolated.test.ts) demonstrates concurrent isolated containers.
- [`large_multiline_unicode_message_renders_without_corruption.test.ts`](tests/large_multiline_unicode_message_renders_without_corruption.test.ts) demonstrates deterministic fuzz input, exact request validation, terminal-health assertions, scroll-transition checks, and a follow-up turn.
