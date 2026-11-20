/**
 * Core's side of the plugin API socket.
 *
 * Isolated plugin workers have no network route to core. They reach the plugin
 * API through a unix socket core listens on, bridged to loopback inside the
 * sandbox. The socket serves the same app as the public listener but only the
 * paths a plugin legitimately calls (the plugin API, and signed media reads),
 * so a worker can't reach anything else.
 */
import { createServer, type IncomingMessage, type RequestListener, type Server } from "http";
import { chmodSync, readdirSync, rmSync } from "fs";
import path from "path";
import { CORE_SOCKET_PATTERN } from "../plugin-host/protocol";
import { socketConfirmedGone } from "../plugin-host/socket-probe";

const PLUGIN_API_ROUTES = new Set(["/v1/plugin-api/send-email", "/v1/plugin-api/health"]);
const PLUGIN_API_PROCEDURE = /^pluginApi\.[A-Za-z0-9_.]+$/;

/**
 * Whether `url` (request path and query) is part of the plugin API. Matching is
 * exact because the router behind this socket is more forgiving than a prefix:
 * unknown /v1/plugin-api paths fall through to tRPC, and tRPC routes on whatever
 * follows the last slash. Batches join procedures in one path (`/v1/a.b,c.d`),
 * and every one must be a plugin API procedure.
 */
export function isPluginApiPath(url: string | undefined): boolean {
  const path = (url ?? "").split("?")[0];
  if (PLUGIN_API_ROUTES.has(path)) return true;
  if (!path.startsWith("/v1/")) return false;
  return path
    .slice("/v1/".length)
    .split(",")
    .every((procedure) => PLUGIN_API_PROCEDURE.test(procedure));
}

const MEDIA_PATH = /^\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a request reads one signed media file: GET /v1/media/<uuid> with
 * exactly the `expires` and `sig` core put in the URL. A worker that must
 * download an attachment (email delivery) fetches the URL core handed it
 * through the socket, since it has no route to core's public host. The path is
 * matched whole, so nothing else under /v1/media (or reached through a longer
 * path) is served, and without a signature the request never reaches the app.
 */
export function isSignedMediaRead(method: string | undefined, url: string | undefined): boolean {
  if (method !== "GET") return false;
  const target = url ?? "";
  const queryStart = target.indexOf("?");
  const path = queryStart === -1 ? target : target.slice(0, queryStart);
  const query = queryStart === -1 ? "" : target.slice(queryStart + 1);
  if (!MEDIA_PATH.test(path)) return false;
  const params = new URLSearchParams(query);
  const keys = [...params.keys()].sort();
  return keys.length === 2 && keys[0] === "expires" && keys[1] === "sig" && !!params.get("sig");
}

/** Serve `app` on a unix socket, limited to the plugin API paths and signed media reads. */
export function listenPluginApiSocket(app: RequestListener, socketPath: string): Promise<Server> {
  const server = createServer((req: IncomingMessage, res) => {
    if (!isPluginApiPath(req.url) && !isSignedMediaRead(req.method, req.url)) {
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

/**
 * Remove the sockets earlier core processes left in `dir`. A socket that is not
 * certainly gone (refused or missing on two probes a few seconds apart)
 * belongs to a core that is running, or busy (a deploy starts the new core before
 * stopping the old one), and stays.
 */
export async function removeStaleApiSockets(dir: string, recheckMs?: number): Promise<number> {
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!CORE_SOCKET_PATTERN.test(name)) continue;
    const socketPath = path.join(dir, name);
    const gone = await socketConfirmedGone(socketPath, recheckMs);
    if (gone) {
      rmSync(socketPath, { force: true });
      removed++;
    }
  }
  return removed;
}
