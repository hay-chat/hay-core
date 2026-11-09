import http from "node:http";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { timingSafeCompare } from "@server/lib/hmac-signature";
import { registerProcessMetrics, renderMetrics } from "@server/lib/metrics";

const logger = createLogger("metrics");

const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** Serves GET /metrics; with a token set, requests must present it as a bearer token. */
export function createMetricsHandler(token: string): http.RequestListener {
  return (req, res) => {
    if (req.method !== "GET" || req.url?.split("?")[0] !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    if (token && !timingSafeCompare(req.headers.authorization ?? "", `Bearer ${token}`)) {
      res.writeHead(401).end();
      return;
    }
    renderMetrics()
      .then((body) => res.writeHead(200, { "Content-Type": CONTENT_TYPE }).end(body))
      .catch((error) => {
        logger.error({ err: error }, "Could not render metrics");
        res.writeHead(500).end();
      });
  };
}

/**
 * Metrics listen on their own port, which no reverse proxy routes to. Anything
 * other than loopback also needs METRICS_TOKEN. Failure to bind never stops
 * the application.
 */
export function startMetricsServer(
  options: { port: number; host: string; token: string } = config.metrics,
): http.Server | null {
  const { port, host, token } = options;
  if (port === 0) return null;
  if (!LOOPBACK_HOSTS.has(host) && !token) {
    logger.error({ host }, "METRICS_HOST is not loopback and METRICS_TOKEN is unset, not serving");
    return null;
  }

  registerProcessMetrics();
  const server = http.createServer(createMetricsHandler(token));
  server.on("error", (error) => logger.error({ err: error, port }, "Metrics server error"));
  server.listen(port, host, () => logger.info({ port, host }, "Metrics server listening"));
  server.unref();
  return server;
}
