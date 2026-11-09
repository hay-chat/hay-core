/** The supervisor's side of the egress proxy's control socket. */
import http from "http";
import type { EgressRegistrar } from "./supervisor";

function call(socketPath: string, method: string, path: string, body?: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath,
        method,
        path,
        timeout: 3000,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("timeout", () => req.destroy(new Error("egress control timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}

export function createEgressRegistrar(proxySocket: string, controlSocket: string): EgressRegistrar {
  return {
    socketPath: proxySocket,
    async register(token, worker) {
      const status = await call(controlSocket, "PUT", `/tokens/${token}`, worker);
      if (status !== 200) throw new Error(`egress proxy refused the registration (${status})`);
    },
    async revoke(token) {
      await call(controlSocket, "DELETE", `/tokens/${token}`);
    },
    async isReachable() {
      return (await call(controlSocket, "GET", "/status").catch(() => 0)) === 200;
    },
  };
}
