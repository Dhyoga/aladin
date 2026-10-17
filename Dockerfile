# syntax=docker/dockerfile:1

# Same base image for build and runtime: better-sqlite3 ships a glibc prebuilt
# binary, so never mix Debian and Alpine here (see AGENTS.md).

# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
# --ignore-scripts: pnpm would run an implicit `node-gyp rebuild` for better-sqlite3 (it has a
# binding.gyp) and fail without Python and a compiler. Not needed: better-sqlite3 v13 only loads
# its bundled prebuilds/linux-x64.node (glibc), and `nuxt build` runs `nuxt prepare` itself.
RUN pnpm install --frozen-lockfile --ignore-scripts
# The VPS is shared with n8n and has little RAM: cap Node's heap (design.md §11).
RUN NODE_OPTIONS=--max-old-space-size=1536 pnpm build

# ---- runner ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
# Nitro does not bundle the Drizzle migrations; server/plugins/migrate.ts reads
# them from <cwd>/server/db/migrations (cwd = /app).
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/server/db/migrations ./server/db/migrations
# Mock mode (first deployment, N8N_MODE=mock) reads its fixtures from <cwd>/server/fixtures.
COPY --from=build --chown=node:node /app/server/fixtures ./server/fixtures
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
