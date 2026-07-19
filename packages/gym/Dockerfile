# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/gym/package.json packages/gym/package.json
COPY packages/gym-tests/package.json packages/gym-tests/package.json
COPY packages/rig/package.json packages/rig/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

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

ENV HOME=/home/rig
ENV TERM=xterm-256color
RUN mkdir -p /home/rig /workspace && chown -R node:node /home/rig /workspace

USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/app/packages/rig/dist/main.js"]
