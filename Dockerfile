# Hay production image. One image, two containers: the API server and the
# dashboard differ only in working directory and command (see selfhost/compose.yml).
#
#   docker build -t hay:local .
#
# The dashboard is built without API_DOMAIN, so in the browser it talks to the
# API on its own origin. Put both behind one domain with a reverse proxy that
# sends the API paths to the server (selfhost/Caddyfile does this).

# ---- toolchain: node + what node-gyp needs for the odd native package -------
FROM node:22-bookworm-slim AS toolchain
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Copied whole rather than package.json-first: the root lockfile covers every
# workspace (server, dashboard, packages, core plugins), and rebuilding that
# layer by layer is more fragile than it is worth.
COPY . .

# ---- build: every dependency, then compile all workspaces ------------------
FROM toolchain AS build
RUN npm ci
# webchat is not an npm workspace, but the server build bundles it.
RUN cd webchat && npm ci
RUN npm run build
# Collect only the build output, at the same paths, for the runtime stage.
# The dashboard's .output is self-contained (Nitro bundles its own node_modules).
RUN mkdir -p /out/dashboard \
    && cp -r dashboard/.output /out/dashboard/ \
    && for d in server webchat packages/* plugins/core/*; do \
         if [ -d "$d/dist" ]; then mkdir -p "/out/$d" && cp -r "$d/dist" "/out/$d/"; fi; \
       done

# ---- deps: production dependencies of what runs on the server --------------
# Skips the dashboard's and webchat's dependencies, and every devDependency.
# The root postinstall (nuxt prepare) and form-schema's prepare (tsc) need dev
# tools and only produce build output, so they are dropped for this install.
FROM toolchain AS deps
RUN npm pkg delete scripts.postinstall \
    && npm pkg delete scripts.prepare -w packages/form-schema \
    && npm ci --omit=dev --include-workspace-root -w server -w packages -w plugins/core
# Each bundled mcp/ server sits outside the workspace with dependencies of its
# own. They are installed here because production never runs npm for core plugins.
RUN for dir in plugins/core/*/mcp; do \
      if [ -f "$dir/package-lock.json" ]; then install=ci; else install=install; fi; \
      (cd "$dir" && npm "$install" --omit=dev --ignore-scripts --no-audit --no-fund) || exit 1; \
    done

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim
WORKDIR /app
# Chromium for website scraping (knowledge-base imports). CHROME_EXECUTABLE_PATH
# points the scraper at it instead of downloading a browser at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates chromium \
    && rm -rf /var/lib/apt/lists/*
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=deps /app /app
COPY --from=build /out /app

ENV NODE_ENV=production
EXPOSE 3000 3001

# The server MUST run with cwd=/app/server: plugins are resolved from
# <cwd>/../plugins.
WORKDIR /app/server
CMD ["node", "dist/main.js"]
