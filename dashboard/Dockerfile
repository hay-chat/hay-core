# Production image for the dashboard. The dashboard is an npm workspace, so
# build from the repository root:
#   docker build -f dashboard/Dockerfile .
FROM node:22-alpine AS build

WORKDIR /app

COPY . .

# Install only the dashboard workspace; `nuxt build` runs `nuxt prepare` itself.
RUN npm ci --workspace dashboard --ignore-scripts --no-audit --no-fund
RUN npm run build:prod --workspace dashboard

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# The Nitro output is self-contained (server + static client bundle).
COPY --from=build --chown=node:node /app/dashboard/.output ./.output

USER node
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
