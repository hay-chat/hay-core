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
# Only what runs: manifests, installed dependencies, prompts and plugin assets.
# TypeScript sources and build configs stay behind; compiled output comes from
# the build stage. --anchored and --no-wildcards-match-slash keep these patterns
# from reaching into node_modules. npm keeps typescript and ts-node as peers of
# other packages, but nothing loads them when running compiled code.
RUN mkdir -p /runtime server/node_modules \
    && tar -cf - --anchored --no-wildcards-match-slash \
         --exclude='node_modules/typescript' \
         --exclude='node_modules/ts-node' \
         --exclude='node_modules/.bin/ts*' \
         --exclude='node_modules/.bin/typeorm-ts-node-*' \
         --exclude='plugins/core/*/src' \
         --exclude='plugins/core/*/tests' \
         --exclude='plugins/core/*/tsconfig*.json' \
         --exclude='plugins/core/*/vitest.config.ts' \
         --exclude='plugins/core/*/vite.config.ui.ts' \
         --exclude='packages/*/src' \
         --exclude='packages/*/tsconfig.json' \
         --exclude='packages/*/vitest.config.ts' \
         --exclude='packages/plugin-sdk/examples' \
         --exclude='packages/plugin-sdk/runner' \
         --exclude='packages/plugin-sdk/sdk' \
         --exclude='packages/plugin-sdk/types' \
         package.json node_modules packages plugins/core \
         server/package.json server/node_modules server/prompts \
       | tar -xf - -C /runtime

# ---- chromium: shared by the app image and the browser sidecar --------------
FROM node:22-bookworm-slim AS chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates chromium \
    && rm -rf /var/lib/apt/lists/*

# ---- browser: isolated Chromium for website imports (docker build --target) -
# Holds no application code or secrets. Chromium only listens on loopback in new
# headless mode, so socat exposes it on the sidecar's private network. Docker's
# default seccomp profile blocks the namespaces Chromium's sandbox needs, so the
# container boundary and the unprivileged user are the isolation here.
FROM chromium AS browser
RUN apt-get update && apt-get install -y --no-install-recommends socat \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin chrome
USER chrome
EXPOSE 9223
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:9222/json/version').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["sh", "-c", "socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 & exec chromium --headless --no-sandbox --disable-dev-shm-usage --disable-gpu --disable-extensions --disable-background-networking --disable-default-apps --disable-sync --no-first-run --force-webrtc-ip-handling-policy=disable_non_proxied_udp --remote-debugging-port=9222 --user-data-dir=/tmp/chrome about:blank"]

# ---- runtime ----------------------------------------------------------------
FROM chromium
WORKDIR /app
# Website imports use this local Chromium unless CHROME_REMOTE_URL points at the
# browser sidecar. A container can't use Chromium's sandbox (see above).
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_DISABLE_SANDBOX=true

# bubblewrap sandboxes plugin workers in the plugin-host container (see
# server/plugin-host/); util-linux (setpriv) is already part of the base image.
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin hay
COPY --from=deps /runtime /app
COPY --from=build /out /app
# The only paths the app writes to: organization plugins, uploads (LOCAL_UPLOAD_PATH
# or its cwd-relative default) and plugin pages. Everything else stays root-owned.
# /run/hay is how the server and the plugin-host container reach each other
# (named volumes copy these owners and modes on first use): 0711 so plugin
# workers can pass through to the API socket, but not list it.
RUN mkdir -p /app/plugins/custom /app/server/server/uploads /data/uploads /app/dashboard/pages/plugins \
      /run/hay/api /run/hay/ctl /run/hay/w /run/hay-egress/pub /run/hay-egress/ctl \
    && chown -R hay:hay /app/plugins/custom /app/server/server/uploads /data/uploads /app/dashboard/pages \
      /run/hay /run/hay-egress \
    && chmod 0711 /run/hay /run/hay-egress \
    && chmod 0771 /run/hay/w \
    && chmod 0755 /run/hay/api /run/hay-egress/pub \
    && chmod 0770 /run/hay/ctl /run/hay-egress/ctl

ENV NODE_ENV=production
# Core plugins are compiled above and the image has no build tools.
ENV PLUGINS_PREBUILT=true
EXPOSE 3000 3001
USER hay

# The server MUST run with cwd=/app/server: plugins are resolved from
# <cwd>/../plugins.
WORKDIR /app/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
