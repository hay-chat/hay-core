# Hay production image. One image, two containers: the API server and the
# dashboard differ only in working directory and command (see selfhost/compose.yml).
#
#   docker build -t hay:local .
#
# The dashboard is built without API_DOMAIN, so in the browser it talks to the
# API on its own origin. Put both behind one domain with a reverse proxy that
# sends the API paths to the server (selfhost/Caddyfile does this).
FROM node:22-bookworm-slim
WORKDIR /app

# Native deps for the odd node-gyp package, plus Chromium for website scraping
# (knowledge-base imports). CHROME_EXECUTABLE_PATH points the scraper at it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates chromium \
    && rm -rf /var/lib/apt/lists/*
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium

# Copied whole rather than package.json-first: the root lockfile covers every
# workspace (server, dashboard, packages, core plugins), and rebuilding that
# layer by layer is more fragile than it is worth.
COPY . .

RUN npm ci
# webchat is not an npm workspace, but the server build bundles it.
RUN cd webchat && npm ci
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000 3001

# The server MUST run with cwd=/app/server: plugins are resolved from
# <cwd>/../plugins.
WORKDIR /app/server
CMD ["node", "dist/main.js"]
