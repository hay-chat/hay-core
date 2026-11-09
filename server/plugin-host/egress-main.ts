/**
 * Entry point of the `plugin-egress` container: `node dist/plugin-host/egress-main.js`.
 *
 * Listens on two unix sockets in /run/hay-egress:
 * - pub/proxy.sock: the proxy itself, reachable by plugin workers.
 * - ctl/control.sock: where the plugin-host supervisor registers each worker's
 *   token and allowed destinations. Its directory is private to the hay group.
 */
import http, { type IncomingMessage, type ServerResponse } from "http";
import { chmodSync, mkdirSync, rmSync } from "fs";
import path from "path";
import { EgressProxy, type WorkerGrant } from "./egress-proxy";
import { log } from "./log";

const proxySocket = process.env.PLUGIN_EGRESS_SOCKET?.trim() || "/run/hay-egress/pub/proxy.sock";
const controlSocket =
  process.env.PLUGIN_EGRESS_CONTROL_SOCKET?.trim() || "/run/hay-egress/ctl/control.sock";

function listen(server: http.Server, socketPath: string, mode: number): Promise<void> {
  mkdirSync(path.dirname(socketPath), { recursive: true });
  rmSync(socketPath, { force: true });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      chmodSync(socketPath, mode);
      resolve();
    });
  });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 256 * 1024) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isGrant(value: unknown): value is WorkerGrant {
  const grant = value as WorkerGrant;
  return (
    typeof grant?.pluginId === "string" &&
    typeof grant?.orgId === "string" &&
    Array.isArray(grant?.allow) &&
    grant.allow.every((rule) => typeof rule === "string")
  );
}

async function main(): Promise<void> {
  const proxy = new EgressProxy();
  await listen(proxy.createServer(), proxySocket, 0o666);

  const control = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://egress");
      const match = /^\/tokens\/([0-9a-f]{16,128})$/.exec(url.pathname);
      if (req.method === "GET" && url.pathname === "/status") return send(200, proxy.decisions);
      if (match && req.method === "PUT") {
        const body = await readBody(req);
        if (!isGrant(body)) return send(400, { error: "invalid grant" });
        proxy.grant(match[1], body);
        return send(200, {});
      }
      if (match && req.method === "DELETE") {
        proxy.revoke(match[1]);
        return send(200, {});
      }
      send(404, { error: "not found" });
    } catch (error) {
      send(400, { error: String(error) });
    }
  });
  await listen(control, controlSocket, 0o660);
  log.info("Egress proxy listening", { proxySocket });

  const stop = (): void => process.exit(0);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((error: unknown) => {
  log.error("Egress proxy failed to start", { err: String(error) });
  process.exit(1);
});
