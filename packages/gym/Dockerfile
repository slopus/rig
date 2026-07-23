# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/gym/package.json packages/gym/package.json
COPY packages/gym-tests/package.json packages/gym-tests/package.json
COPY packages/ghostty-web/package.json packages/ghostty-web/package.json
COPY packages/rig-codemode-codex/package.json packages/rig-codemode-codex/package.json
COPY packages/rig-providers/package.json packages/rig-providers/package.json
COPY packages/rig-execution/package.json packages/rig-execution/package.json
COPY packages/rig/package.json packages/rig/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

COPY packages/ghostty-web packages/ghostty-web
COPY packages/rig-codemode-codex packages/rig-codemode-codex
COPY packages/rig-providers packages/rig-providers
COPY packages/rig-execution packages/rig-execution
COPY packages/rig packages/rig
RUN pnpm --filter @slopus/ghostty-web build
RUN pnpm --filter @slopus/rig-codemode-codex build
RUN pnpm --filter @slopus/rig-providers build
RUN pnpm --filter @slopus/rig-execution build
RUN pnpm --filter @slopus/rig build
RUN pnpm --filter @slopus/rig deploy --prod --legacy /prod/rig
RUN node --input-type=module --eval "import { readFileSync, writeFileSync } from 'node:fs'; const path = '/prod/rig/node_modules/@slopus/ghostty-web/package.json'; const manifest = JSON.parse(readFileSync(path, 'utf8')); manifest.exports['.'] = { types: './dist/index.d.ts', default: './dist/index.js' }; writeFileSync(path, JSON.stringify(manifest, null, 2) + '\\n')"
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

ENV HOME=/home/rig
ENV TERM=xterm-256color
RUN mkdir -p /home/rig /workspace && chown -R node:node /home/rig /workspace

USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/app/packages/rig/dist/main.js"]
