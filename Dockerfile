# One image for the editor, with two targets:
#
# - `app`: the API, which also serves the built page on the same origin.
# - `migrator`: applies the migrations of `packages/db` to `DATABASE_URL`, then stops.
#
# Build from the root of the repository: pnpm needs the workspace files to resolve
# the `catalog:` versions.

# Keep NODE_VERSION equal to `.node-version`, which the workflows read.
ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-slim AS base
ARG PNPM_VERSION=11.17.0
RUN npm install -g pnpm@$PNPM_VERSION
# The `prepare` script installs the git hooks. An image has no git repository.
ENV HUSKY=0
WORKDIR /app

FROM base AS deps
COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --link packages/api/package.json ./packages/api/
COPY --link packages/db/package.json ./packages/db/
COPY --link packages/mcp/package.json ./packages/mcp/
COPY --link packages/web/package.json ./packages/web/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY --link packages ./packages
# React Router renders the page once, through a server on `localhost`. In this
# image `localhost` resolves to ::1 first, and the client then connects to
# 127.0.0.1 and gets ECONNREFUSED.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN pnpm --filter @i18n-editor/api run build \
 && pnpm --filter @i18n-editor/web run build

# Only the runtime dependencies of the API. The bundle holds `packages/db`.
# None of them needs an install script, and the `prepare` script of the root
# calls husky, which a production install does not have.
FROM base AS prod-deps
COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --link packages/api/package.json ./packages/api/
COPY --link packages/db/package.json ./packages/db/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter @i18n-editor/api...

# drizzle-kit and the driver it migrates with, and nothing of the other packages.
FROM base AS migrator-deps
COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --link packages/db/package.json ./packages/db/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @i18n-editor/db

FROM base AS migrator
ENV NODE_ENV=production
COPY --from=migrator-deps --link /app/node_modules ./node_modules
COPY --from=migrator-deps --link /app/packages/db/node_modules ./packages/db/node_modules
COPY --link package.json pnpm-workspace.yaml ./
COPY --link packages/db ./packages/db
USER node
CMD ["pnpm", "--filter", "@i18n-editor/db", "run", "migrate"]

FROM node:${NODE_VERSION}-slim AS app
ENV NODE_ENV=production \
    PORT=8001 \
    WEB_ROOT=/app/web
WORKDIR /app
COPY --from=prod-deps --link /app/node_modules ./node_modules
COPY --from=prod-deps --link /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=build --link /app/packages/api/package.json ./packages/api/
COPY --from=build --link /app/packages/api/build ./packages/api/build
COPY --from=build --link /app/packages/web/build/client ./web
USER node
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((answer) => process.exit(answer.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "packages/api/build/index.js"]
