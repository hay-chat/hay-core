/**
 * Hay Plugin SDK - Loopback bridge
 *
 * A worker in an isolated sandbox has no network, only unix sockets. Plugin
 * code and the libraries it uses still speak TCP (`fetch`, an HTTP proxy
 * setting), so the runner opens a loopback listener that copies bytes to a
 * unix socket the host bind-mounted into the sandbox.
 *
 * @module @hay/plugin-sdk/runner/loopback-bridge
 */

import net from "net";
import type { HayLogger } from "../types/index.js";

export const BRIDGE_HOST = "127.0.0.1";

/**
 * Listen on loopback `port` and pipe every connection to the unix socket at
 * `socketPath`. The listener never keeps the process alive on its own.
 */
export function startLoopbackBridge(port: number, socketPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      const upstream = net.connect(socketPath);
      client.pipe(upstream);
      upstream.pipe(client);
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    });
    server.once("error", reject);
    server.listen(port, BRIDGE_HOST, () => {
      server.off("error", reject);
      server.unref();
      resolve(server);
    });
  });
}

function readPort(name: string): number {
  const port = Number(process.env[name]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number when its socket is set`);
  }
  return port;
}

/**
 * Open the bridges the host asked for through the environment:
 * - HAY_API_SOCKET + HAY_API_BRIDGE_PORT: calls to core's plugin API.
 * - HAY_EGRESS_SOCKET + HAY_EGRESS_BRIDGE_PORT: the outbound proxy.
 * Must run before plugin code loads, because Node reads the proxy settings
 * from the environment when the first request is made.
 */
export async function startSandboxBridges(logger: HayLogger): Promise<void> {
  const apiSocket = process.env.HAY_API_SOCKET;
  if (apiSocket) {
    await startLoopbackBridge(readPort("HAY_API_BRIDGE_PORT"), apiSocket);
    logger.info("Plugin API bridge listening", { port: process.env.HAY_API_BRIDGE_PORT });
  }
  const egressSocket = process.env.HAY_EGRESS_SOCKET;
  if (egressSocket) {
    await startLoopbackBridge(readPort("HAY_EGRESS_BRIDGE_PORT"), egressSocket);
    logger.info("Egress bridge listening", { port: process.env.HAY_EGRESS_BRIDGE_PORT });
  }
}
