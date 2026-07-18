# @slopus/ghostty-wasm

Ghostty's terminal engine packaged as prebuilt WebAssembly for Node.js and browsers.

Consumers do not need Rust, Cargo, Zig, or a Ghostty checkout. The npm package contains a pinned Ghostty 1.3.1 WASM binary, environment-specific loaders, and a common TypeScript API.

## Install

```sh
pnpm add @slopus/ghostty-wasm
```

The equivalent npm command is `npm install @slopus/ghostty-wasm`.

## Basic integration

The root export uses package conditions. Node.js gets the filesystem loader and browsers get the fetch loader.

```ts
import { createGhosttyTerminal } from "@slopus/ghostty-wasm";

const terminal = await createGhosttyTerminal({
    cols: 80,
    rows: 24,
    maxScrollback: 10_000,
});

terminal.write("hello\r\n");

const snapshot = terminal.snapshot();
console.log(snapshot.rows);

terminal.scrollToTop();
const firstHundredRows = terminal.snapshotPage(0, 100);
terminal.scrollToBottom();
terminal.resize(120, 40);
terminal.dispose();
```

Call `dispose()` when the terminal is no longer needed. It releases the Zig and Ghostty allocations held in WebAssembly memory.

### Node.js

```ts
import { createGhosttyTerminal } from "@slopus/ghostty-wasm/node";

const terminal = await createGhosttyTerminal({ cols: 80, rows: 24 });
```

The Node.js loader reads `wasm/ghostty-vt.wasm` directly from the installed package. It never calls `fetch()` with a `file:` URL.

### Browser

```ts
import { createGhosttyTerminal } from "@slopus/ghostty-wasm/browser";

const terminal = await createGhosttyTerminal({ cols: 80, rows: 24 });
terminal.write(new TextEncoder().encode("hello\r\n"));
```

The browser loader resolves the bundled asset with `new URL(..., import.meta.url)` and fetches it. Vite, Rollup, webpack, esbuild, and similar bundlers normally copy and rewrite this asset automatically.

## Custom WASM loading and bundler escape hatches

There are three ways to bypass the automatic loader. They use the same terminal API after loading.

### Supply a `loadWasm` callback

This is the easiest escape hatch when a bundler, CDN, CSP, Electron setup, or server framework needs to control the asset location.

```ts
import { createGhosttyTerminal } from "@slopus/ghostty-wasm/browser";

const terminal = await createGhosttyTerminal({
    cols: 80,
    rows: 24,
    loadWasm: async () => {
        const response = await fetch("/static/ghostty-vt.wasm");
        if (!response.ok) throw new Error(`WASM request failed: ${response.status}`);
        return response.arrayBuffer();
    },
});
```

When `loadWasm` is present, the package does not run its default filesystem or fetch loader.

The callback can also return an already available `ArrayBuffer`:

```ts
const terminal = await createGhosttyTerminal({
    loadWasm: () => cachedGhosttyWasm,
});
```

### Instantiate from bytes directly

Use `createGhosttyTerminalFromWasm` when your application owns the entire loading and caching lifecycle.

```ts
import { createGhosttyTerminalFromWasm } from "@slopus/ghostty-wasm";

const response = await fetch("https://cdn.example.com/ghostty-vt.wasm");
const wasm = await response.arrayBuffer();

const terminal = await createGhosttyTerminalFromWasm(wasm, {
    cols: 80,
    rows: 24,
});
```

Node.js can do the same with a custom path:

```ts
import { readFile } from "node:fs/promises";
import { createGhosttyTerminalFromWasm } from "@slopus/ghostty-wasm/node";

const file = await readFile("/opt/my-app/ghostty-vt.wasm");
const wasm = Uint8Array.from(file).buffer;
const terminal = await createGhosttyTerminalFromWasm(wasm);
```

### Let the bundler return an asset URL

The raw file is exported as `@slopus/ghostty-wasm/wasm`. Bundlers with URL imports can copy it themselves. For example, with Vite:

```ts
import wasmUrl from "@slopus/ghostty-wasm/wasm?url";
import { createGhosttyTerminal } from "@slopus/ghostty-wasm/browser";

const terminal = await createGhosttyTerminal({
    loadWasm: async () => (await fetch(wasmUrl)).arrayBuffer(),
});
```

If a bundler chooses the wrong conditional export, import `/node` or `/browser` explicitly. If it cannot process package-relative WASM URLs, copy `@slopus/ghostty-wasm/wasm` into the application's public assets and use `loadWasm`. These paths bypass all package asset-resolution assumptions.

## Package exports

| Export                         | Purpose                              |
| ------------------------------ | ------------------------------------ |
| `@slopus/ghostty-wasm`         | Conditional Node.js/browser entry    |
| `@slopus/ghostty-wasm/node`    | Explicit Node.js filesystem loader   |
| `@slopus/ghostty-wasm/browser` | Explicit browser fetch loader        |
| `@slopus/ghostty-wasm/wasm`    | Raw prebuilt `ghostty-vt.wasm` asset |

The three JavaScript entries expose the same public API.

## API reference

### Factory functions

```ts
function createGhosttyTerminal(options?: GhosttyLoadOptions): Promise<GhosttyTerminal>;

function createGhosttyTerminalFromWasm(
    source: ArrayBuffer,
    options?: GhosttyOptions,
): Promise<GhosttyTerminal>;
```

`createGhosttyTerminal` uses the environment's bundled loader unless `loadWasm` is supplied. `createGhosttyTerminalFromWasm` never performs filesystem or network access.

### `GhosttyTerminal`

```ts
class GhosttyTerminal {
    static create(source: ArrayBuffer, options?: GhosttyOptions): Promise<GhosttyTerminal>;

    write(data: string | Uint8Array): void;
    resize(cols: number, rows: number): void;
    scrollBy(rows: number): void;
    scrollTo(row: number): void;
    scrollToTop(): void;
    scrollToBottom(): void;
    snapshot(): GhosttySnapshot;
    snapshotPage(startRow: number, rowCount: number): GhosttySnapshot;
    setColorScheme(colorScheme: "dark" | "light"): void;
    onPtyWrite(handler: (data: Uint8Array) => void): () => void;
    dispose(): void;
}
```

- `write` parses UTF-8 text and VT escape sequences with Ghostty. A streaming decoder and bounded pending buffer preserve UTF-8 and grapheme clusters when bytes arrive in arbitrarily small chunks.
- `resize` changes the active grid dimensions.
- `scrollBy` scrolls the native Ghostty viewport; positive values move toward the bottom and negative values move toward older history.
- `scrollTo`, `scrollToTop`, and `scrollToBottom` position the native viewport without resizing the terminal.
- `snapshot` returns the current native viewport and terminal metadata.
- `snapshotPage` returns any requested scrollback range, including ranges larger than the viewport. It restores the viewport to its exact previous offset before returning.
- `setColorScheme` switches the default foreground/background pair and emits the standard color-scheme notification when terminal mode 2031 is enabled.
- `onPtyWrite` subscribes to bytes that must be written back to the attached PTY. It returns an unsubscribe function. See [PTY integration](#pty-integration).
- `dispose` is idempotent. Other methods throw after disposal.
- `GhosttyTerminal.create` is the low-level equivalent of `createGhosttyTerminalFromWasm`.

### Options and loader types

```ts
interface GhosttyOptions {
    cols?: number; // default: 80
    rows?: number; // default: 24
    maxScrollback?: number; // default: 10_000
    colorScheme?: "dark" | "light"; // default: "dark"
}

type GhosttyWasmSource = ArrayBuffer;
type GhosttyWasmLoader = () => ArrayBuffer | Promise<ArrayBuffer>;

interface GhosttyLoadOptions extends GhosttyOptions {
    loadWasm?: GhosttyWasmLoader;
}
```

### Snapshot types

```ts
interface GhosttySnapshot {
    cols: number;
    cursor: GhosttyCursor | null;
    cursorColor: GhosttyColor | null;
    defaultBackground: GhosttyColor;
    defaultForeground: GhosttyColor;
    outputRevision: number;
    palette: readonly GhosttyColor[];
    rows: readonly GhosttyRow[];
    startRow: number;
    synchronizedOutputActive: boolean;
    title: string;
    totalRows: number;
    visibleRows: number;
}

interface GhosttyRow {
    cells: readonly GhosttyCell[];
    wrapped: boolean;
}

interface GhosttyCell {
    style: GhosttyStyle;
    text: string;
    width: 1 | 2;
    x: number;
}

interface GhosttyCursor {
    blinking: boolean;
    shape: "bar" | "block" | "block_hollow" | "underline";
    visible: boolean;
    x: number;
    y: number;
}
```

Blank cells with default styling are omitted from `GhosttyRow.cells`; use each cell's `x` coordinate to preserve its grid position. Styled blank cells are returned with a single-space `text` value. `palette` always contains Ghostty's 256 resolved RGB entries. `startRow` is the first returned row's absolute offset in `totalRows`; `visibleRows` is Ghostty's native viewport height. A `snapshotPage` result may contain more or fewer rows than `visibleRows`.

`outputRevision` advances for input writes and resizes, not for viewport scrolling. This makes it suitable for invalidating rendered output without treating a scroll gesture as new PTY output. `synchronizedOutputActive` reflects DEC private mode 2026 so a renderer can defer painting until a synchronized update ends.

### Color and style types

```ts
type GhosttyColor =
    | { kind: "palette"; index: number }
    | { kind: "rgb"; red: number; green: number; blue: number };

type GhosttyUnderline = "curly" | "dashed" | "dotted" | "double" | "none" | "single";

interface GhosttyStyle {
    background: GhosttyColor | null;
    blink: boolean;
    bold: boolean;
    dim: boolean;
    foreground: GhosttyColor | null;
    invisible: boolean;
    inverse: boolean;
    italic: boolean;
    overline: boolean;
    strikethrough: boolean;
    underline: GhosttyUnderline;
    underlineColor: GhosttyColor | null;
}
```

Palette colors preserve their palette index instead of being flattened into RGB. This lets a renderer respond correctly when the palette changes.

## PTY integration

Ghostty's read-only stream parses terminal output. The wrapper detects the queries that require a host response and exposes them as PTY bytes:

- primary device attributes (`CSI c`), reported as VT level 62 with ANSI color support;
- foreground and background color queries (`OSC 10;?` and `OSC 11;?`), using the current effective defaults;
- dark/light color-scheme changes while private mode 2031 is enabled.

Connect the response callback to the PTY's input side:

```ts
const unsubscribe = terminal.onPtyWrite((bytes) => pty.write(bytes));

pty.onData((bytes) => terminal.write(bytes));

// During teardown:
unsubscribe();
terminal.dispose();
```

The callback always receives `Uint8Array`, in both Node.js and browsers. Query recognition is incremental, so escape sequences can be split across any number of `write` calls.

## Rendering in the browser

Snapshots are renderer-neutral. Iterate rows and cells, use `x` and `width` for grid placement, and resolve palette colors against `snapshot.palette`:

```ts
function resolveColor(color: GhosttyColor | null, snapshot: GhosttySnapshot) {
    if (color === null) return null;
    return color.kind === "palette" ? snapshot.palette[color.index] : color;
}

const snapshot = terminal.snapshot();
for (const [y, row] of snapshot.rows.entries()) {
    for (const cell of row.cells) {
        drawCell({
            x: cell.x,
            y,
            columns: cell.width,
            text: cell.text,
            foreground: resolveColor(cell.style.foreground, snapshot),
            background: resolveColor(cell.style.background, snapshot),
            style: cell.style,
        });
    }
}
```

The API retains grapheme text, wide-cell width, all exposed text attributes, row wrapping, cursor shape/visibility, default and cursor colors, and the full 256-color palette. It does not prescribe DOM, Canvas, WebGL, font selection, cell metrics, or cursor animation.

## Runtime boundaries

- Window titles are tracked by the TypeScript wrapper from OSC 0 and OSC 2 sequences because the low-level render snapshot does not retain them.
- Each terminal instance owns independent WebAssembly state. Do not use an instance after `dispose()`.
- PTY process creation and transport are intentionally left to the host application; this package is the terminal state machine and snapshot/rendering boundary.

## What is patched

This package does not maintain a broad fork of Ghostty's terminal behavior. It pins the official Ghostty 1.3.1 source archive and applies a small, versioned allocator patch required by `wasm32-freestanding`:

1. `PageList.zig` selects `std.heap.wasm_allocator` for terminal page allocations on WebAssembly. Native builds retain Ghostty's original macOS tagged allocator and standard page allocator paths.
2. `page.zig` avoids resolving `std.posix` on WebAssembly.
3. Page initialization uses aligned WebAssembly allocation and explicitly zeroes the page, preserving the zero-filled memory assumption Ghostty gets from anonymous `mmap` on native platforms.
4. Page destruction uses `wasm_allocator.free` instead of `munmap`.
5. Page cloning allocates its destination with the WebAssembly allocator instead of `mmap`.

The Zig bridge adds the stable JavaScript-facing ABI for lifecycle, input, resizing, native viewport positioning, arbitrary scrollback access, viewport cells, grapheme text, styles, cursor state, palette/default colors, terminal modes, wrapping, and scrollback metadata. The Node/browser loaders, chunk-safe input buffer, PTY response surface, title tracking, and rich snapshot API are maintained in this package rather than patched into Ghostty.

The allocator approach was derived from `@wterm/ghostty`. Its Apache 2.0 license and Ghostty's MIT license are included in the published package.

## Build and test

The committed WASM file is the artifact shipped to consumers. Normal TypeScript builds, installs, packing, and publishing do not require Zig or Cargo.

```sh
pnpm test
pnpm build
```

Maintainers can explicitly rebuild the committed WASM with Zig 0.15.x:

```sh
pnpm build:wasm
```

That command downloads the pinned Ghostty source, verifies its Zig package hash, applies `patches/ghostty-1.3.1-wasm.patch`, and writes `wasm/ghostty-vt.wasm`.

## Publish from a workstation

Set the desired version in this package's `package.json`, then authenticate with the npm registry:

```sh
pnpm login --registry=https://registry.npmjs.org/
pnpm whoami --registry=https://registry.npmjs.org/
```

The second command must print the npm username that owns the `@slopus` personal scope or belongs to the `slopus` npm organization with permission to create packages. npm commonly reports missing scope permission as `404 Not Found` instead of exposing authorization details.

Then run:

```sh
pnpm publish:npm
```

From the repository root, the equivalent command is:

```sh
pnpm --filter @slopus/ghostty-wasm publish:npm
```

The command first verifies the active npm account, builds the TypeScript distribution, runs the test suite, and then publishes the committed WASM plus the version already present in `package.json` to `https://registry.npmjs.org/`. The final publish step ignores lifecycle scripts because the build and tests have already run explicitly. It does not run `pnpm version`, create a Git commit, or create a Git tag. npm will reject a version that has already been published.

To inspect the exact tarball without publishing:

```sh
pnpm pack
```
