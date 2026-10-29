# syntax=docker/dockerfile:1

# Build and runtime share the exact same base image (not just the same distro
# family) so better-sqlite3's native addon is guaranteed binary-compatible
# between the two stages — no glibc version mismatch to worry about. Unlike
# model-hub, hermano has no headless-browser/thumbnail-rendering requirement,
# so a plain node:slim image is enough (no Playwright base needed), keeping
# the final image dramatically smaller.
ARG NODE_IMAGE=node:26-slim

FROM ${NODE_IMAGE} AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Corepack is no longer shipped with Node.js >= 25 (removed from the
# distribution in the Node 25 line), so the package manager is installed
# explicitly. Its version is read from the root package.json `packageManager`
# field rather than repeated here as a second ARG: that field is the single
# source of truth for pnpm (mise reads the same field for CI and local dev), so
# the pnpm that builds this image cannot drift from the pnpm CI tests with.
# The Corepack-style `+sha...` suffix Renovate may append is stripped; pnpm
# itself validates the pin at runtime.
COPY package.json ./
RUN npm install -g "pnpm@$(node -p 'require("./package.json").packageManager.split("@")[1].split("+")[0]')" \
    && pnpm --version

COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @hermano/shared build \
    && pnpm --filter @hermano/server build \
    && pnpm --filter @hermano/web build

# Extracts just the server + its resolved production dependencies (workspace:*
# deps inlined as real files) into a self-contained directory — excludes
# apps/web's entire dependency tree and every devDependency.
RUN pnpm --filter @hermano/server deploy --prod --legacy /app/deploy/server

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

RUN mkdir -p /data && chown node:node /data

# pnpm's `--legacy` deploy mode symlinks (not copies) an internal workspace
# dependency like @hermano/shared, via a path relative to the deploy target
# that resolves to /app/packages/shared in the build stage
# (deploy/server/node_modules/@hermano/shared -> ../../../../packages/shared).
# Preserve that exact same relative depth here (server under ./deploy/,
# shared under ./packages/, both directly under WORKDIR /app) rather than
# flattening server to ./server, or the symlink dangles at container start.
COPY --chown=node:node --from=build /app/deploy/server ./deploy/server
COPY --chown=node:node --from=build /app/packages/shared ./packages/shared
COPY --chown=node:node --from=build /app/apps/web/dist ./web-dist

ENV NODE_ENV=production \
    STATIC_WEB_DIR=/app/web-dist \
    HERMANO_DATABASE_PATH=/data/hermano.sqlite3 \
    HERMANO_PORT=8080

EXPOSE 8080
VOLUME ["/data"]

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.HERMANO_PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "deploy/server/dist/index.js"]
