FROM rust:1.90-bookworm AS terminal-build

ARG ZIG_VERSION=0.15.2
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl xz-utils \
    && case "$(uname -m)" in \
        x86_64) zig_arch=x86_64 ;; \
        aarch64|arm64) zig_arch=aarch64 ;; \
        *) echo "Unsupported Zig architecture: $(uname -m)" >&2; exit 1 ;; \
    esac \
    && mkdir -p /opt/zig \
    && curl --fail --location --silent --show-error \
        "https://ziglang.org/download/${ZIG_VERSION}/zig-${zig_arch}-linux-${ZIG_VERSION}.tar.xz" \
        | tar --extract --xz --strip-components=1 --directory=/opt/zig \
    && ln -s /opt/zig/zig /usr/local/bin/zig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY packages/rig/terminal/Cargo.toml packages/rig/terminal/Cargo.lock ./
COPY packages/rig/terminal/src ./src
RUN cargo build --release \
    && case "$(uname -m)" in \
        x86_64) target=x64 ;; \
        aarch64|arm64) target=arm64 ;; \
        *) echo "Unsupported terminal helper architecture: $(uname -m)" >&2; exit 1 ;; \
    esac \
    && mkdir -p "/terminal-bin/linux-$target" \
    && cp target/release/rig-terminal-state "/terminal-bin/linux-$target/rig-terminal-state"

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/gym/package.json packages/gym/package.json
COPY packages/gym-tests/package.json packages/gym-tests/package.json
COPY packages/rig/package.json packages/rig/package.json
RUN pnpm install --frozen-lockfile

COPY packages/rig packages/rig
RUN pnpm --filter @slopus/rig build
RUN pnpm --filter @slopus/rig deploy --prod --legacy /prod/rig
RUN pnpm --filter @slopus/rig-gym-tests deploy --prod --legacy /prod/gym

FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        bash \
        bubblewrap \
        ca-certificates \
        git \
        procps \
        ripgrep \
        socat \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory /workspace

WORKDIR /app
COPY --from=build /prod/rig packages/rig
COPY --from=build /prod/gym gym
COPY --from=terminal-build /terminal-bin packages/rig/terminal/bin

ENV HOME=/home/rig
ENV TERM=xterm-256color
RUN mkdir -p /home/rig /workspace && chown -R node:node /home/rig /workspace

USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/app/packages/rig/dist/main.js"]
