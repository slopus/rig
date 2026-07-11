FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/rig/package.json packages/rig/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

COPY packages/rig packages/rig
COPY packages/web packages/web
RUN pnpm --filter @slopus/rig build
RUN pnpm --filter @slopus/rig deploy --prod --legacy /prod/rig

FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends bash ca-certificates git procps ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory /workspace

WORKDIR /app
COPY --from=build /prod/rig packages/rig

ENV HOME=/home/rig
ENV TERM=xterm-256color
RUN mkdir -p /home/rig /workspace && chown -R node:node /home/rig /workspace

USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/app/packages/rig/dist/main.js"]
