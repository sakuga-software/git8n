# The editor: the API, which also serves the built page on the same origin.
# Build from the root of the repository: pnpm needs the workspace files to
# resolve the `catalog:` versions, and the page imports the client of `packages/mcp`.
# The API also serves the site of `docs` at /docs.
#
#   docker build -f packages/api/Dockerfile -t git8n .

# Keep NODE_VERSION equal to `.node-version`, which the workflows read.
ARG NODE_VERSION=26.12.1

FROM ghcr.io/pnpm/pnpm:12.15.0@sha256:d6148daf3ad2af8fa4ecd1aa06db73da32b2e37f63088987eea2fb375ee7f320 AS pnpm

FROM node:${NODE_VERSION}-slim AS base
COPY --from=pnpm /opt/pnpm /opt/pnpm
RUN ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm
# The `prepare` script of the root installs the git hooks. An image has no git repository.
ENV HUSKY=0
WORKDIR /app

FROM base AS build
COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --link packages/api/package.json ./packages/api/
COPY --link packages/db/package.json ./packages/db/
COPY --link packages/mcp/package.json ./packages/mcp/
COPY --link packages/web/package.json ./packages/web/
COPY --link docs/package.json ./docs/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @git8n/api... --filter @git8n/web... --filter @git8n/docs
COPY --link packages ./packages
COPY --link docs ./docs
# React Router renders the page once, through a server on `localhost`. In this
# image `localhost` resolves to ::1 first, and the client then connects to
# 127.0.0.1 and gets ECONNREFUSED.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN pnpm --filter @git8n/api run build \
 && pnpm --filter @git8n/web run build \
 && pnpm --filter @git8n/docs run build

# Only the runtime dependencies of the API. The bundle holds `packages/db`.
# None of them needs an install script, and the `prepare` script of the root
# calls husky, which a production install does not have.
FROM base AS prod-deps
COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --link packages/api/package.json ./packages/api/
COPY --link packages/db/package.json ./packages/db/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter @git8n/api...

FROM node:${NODE_VERSION}-slim
ENV NODE_ENV=production \
    PORT=8001 \
    WEB_ROOT=/app/web
# The image carries no pnpm, npm or corepack.
RUN apt-get update -qq && \
    apt-get upgrade -y && \
    rm -rf /var/lib/apt/lists/* \
      /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=prod-deps --link /app/node_modules ./node_modules
COPY --from=prod-deps --link /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=build --link /app/packages/api/package.json ./packages/api/
COPY --from=build --link /app/packages/api/build ./packages/api/build
COPY --from=build --link /app/packages/web/build/client ./web
COPY --from=build --link /app/docs/.vitepress/dist ./web/docs
USER node
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((answer) => process.exit(answer.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "packages/api/build/index.js"]
