# The build context must be the root of the repository: pnpm needs the workspace
# files to resolve the `catalog:` versions, and the editor imports the client
# of `packages/mcp`.

# Keep NODE_VERSION equal to `.node-version` at the root, which the workflows read.
ARG NODE_VERSION=24.21.0
FROM node:${NODE_VERSION}-slim AS build

ARG PNPM_VERSION=11.17.0
RUN npm install -g pnpm@$PNPM_VERSION

WORKDIR /app

COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --link packages/web/package.json ./packages/web/
COPY --link packages/mcp/package.json ./packages/mcp/

RUN pnpm install --frozen-lockfile --filter @i18n-editor/web...

COPY --link packages/web ./packages/web
COPY --link packages/mcp ./packages/mcp

# The build renders the page once, through a server that React Router starts on
# `localhost`. In this image `localhost` resolves to ::1 first, so the server
# binds to IPv6 only, but its client connects to 127.0.0.1 and gets
# ECONNREFUSED. Node must prefer IPv4 to make the two agree.
ENV NODE_OPTIONS=--dns-result-order=ipv4first

RUN pnpm --filter @i18n-editor/web run build

# The page is static (`ssr: false`), so the image that runs holds no Node.
FROM nginx:1.29-alpine AS production

COPY --link packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/build/client /usr/share/nginx/html

EXPOSE 80
