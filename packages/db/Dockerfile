# The migrator: applies the migrations of this package to `DATABASE_URL`, then
# stops. Build from the root of the repository: pnpm needs the workspace files
# to resolve the `catalog:` versions.
#
#   docker build -f packages/db/Dockerfile -t i18n-editor-migrator .

# Keep NODE_VERSION equal to `.node-version`, which the workflows read.
ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-slim AS build
ARG PNPM_VERSION=11.17.0
RUN npm install -g pnpm@$PNPM_VERSION
WORKDIR /app
COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --link packages/db/package.json ./packages/db/
# `--ignore-scripts` skips the `prepare` script of the root, which calls husky.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @i18n-editor/db
COPY --link packages/db ./packages/db
RUN pnpm --filter @i18n-editor/db run build

# One bundle and the SQL files. The bundle finds `drizzle/` at `../drizzle` from `dist/`.
FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
COPY --from=build --link /app/packages/db/dist ./dist
COPY --from=build --link /app/packages/db/drizzle/migrations ./drizzle/migrations
CMD ["dist/migrate.mjs"]
