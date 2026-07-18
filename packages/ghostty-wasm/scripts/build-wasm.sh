#!/usr/bin/env bash
set -euo pipefail

package_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ghostty_hash="ghostty-1.3.1-5UdBCwYm-gQeBa4bu1-sMooCQS4KVriv5wWSIJ_sI-Cb"
zig_cache_dir="${ZIG_GLOBAL_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/zig}"
local_cache_dir="$zig_cache_dir/slopus-ghostty-wasm"
ghostty_source="$zig_cache_dir/p/$ghostty_hash"

cd "$package_dir/zig"
# Fetch the pinned dependency before applying its WebAssembly patch.
zig build \
    --cache-dir "$local_cache_dir" \
    --global-cache-dir "$zig_cache_dir" \
    --fetch=all

if [[ ! -f "$ghostty_source/src/terminal/page.zig" ]]; then
    echo "Unable to locate the pinned Ghostty source at $ghostty_source" >&2
    exit 1
fi

if ! grep -q '@slopus/ghostty-wasm\|@wterm/ghostty' "$ghostty_source/src/terminal/page.zig"; then
    patch --directory "$ghostty_source" --strip 1 < "$package_dir/patches/ghostty-1.3.1-wasm.patch"
fi

zig build \
    --cache-dir "$local_cache_dir" \
    --global-cache-dir "$zig_cache_dir" \
    -Doptimize=ReleaseSmall
mkdir -p "$package_dir/wasm"
cp zig-out/bin/ghostty-vt.wasm "$package_dir/wasm/ghostty-vt.wasm"
