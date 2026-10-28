# The migrator: applies the migrations of this package to `DATABASE_URL`, then
# stops. Build from the root of the repository: pnpm needs the workspace files
# to resolve the `catalog:` versions.
#
#   docker build -f packages/db/Dockerfile -t git8n-migrator .

# Keep NODE_VERSION equal to `.node-version`, which the workflows read.
ARG NODE_VERSION=26.12.1

FROM ghcr.io/pnpm/pnpm:12.15.0@sha256:d6148daf3ad2af8fa4ecd1aa06db73da32b2e37f63088987eea2fb375ee7f320 AS pnpm

FROM node:${NODE_VERSION}-slim AS build
COPY --from=pnpm /opt/pnpm /opt/pnpm
RUN ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm
WORKDIR /app
COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --link packages/db/package.json ./packages/db/
# `--ignore-scripts` skips the `prepare` script of the root, which calls husky.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @git8n/db
COPY --link packages/db ./packages/db
RUN pnpm --filter @git8n/db run build

# One bundle and the SQL files. The bundle finds `drizzle/` at `../drizzle` from `dist/`.
FROM gcr.io/distroless/nodejs26-debian13:nonroot
WORKDIR /app
COPY --from=build --link /app/packages/db/dist ./dist
COPY --from=build --link /app/packages/db/drizzle/migrations ./drizzle/migrations
CMD ["dist/migrate.mjs"]
