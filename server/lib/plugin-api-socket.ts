/**
 * Core's side of the plugin API socket.
 *
 * Isolated plugin workers have no network route to core. They reach the plugin
 * API through a unix socket core listens on, bridged to loopback inside the
 * sandbox. The socket serves the same app as the public listener but only the
 * paths a plugin legitimately calls, so a worker can't reach anything else.
 */
import { createServer, type IncomingMessage, type RequestListener, type Server } from "http";
import { chmodSync, rmSync } from "fs";

const PLUGIN_API_PREFIX = "/v1/plugin-api/";

/**
 * Whether `url` (request path and query) is part of the plugin API. tRPC batches
 * join procedures in one path (`/v1/a.b,c.d`), and every one must be a plugin
 * API procedure.
 */
export function isPluginApiPath(url: string | undefined): boolean {
  const path = (url ?? "").split("?")[0];
  if (path.includes("..") || path.includes("//")) return false;
  if (path.startsWith(PLUGIN_API_PREFIX)) return true;
  if (!path.startsWith("/v1/")) return false;
  const procedures = path.slice("/v1/".length).split(",");
  return procedures.every((procedure) => procedure.startsWith("pluginApi."));
}

/** Serve `app` on a unix socket, limited to the plugin API paths. */
export function listenPluginApiSocket(app: RequestListener, socketPath: string): Promise<Server> {
  const server = createServer((req: IncomingMessage, res) => {
    if (!isPluginApiPath(req.url)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    app(req, res);
  });
  return new Promise((resolve, reject) => {
    rmSync(socketPath, { force: true });
    server.once("error", reject);
    server.listen(socketPath, () => {
      // Workers run as other users in some isolation tiers; the JWT on every
      // request is what authorizes them.
      chmodSync(socketPath, 0o666);
      resolve(server);
    });
  });
}
