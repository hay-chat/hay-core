/** The supervisor's side of the egress proxy's control socket. */
import http from "http";
import type { EgressDecisions } from "./protocol";
import type { EgressRegistrar } from "./supervisor";

function call(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
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
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
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
      const { status } = await call(controlSocket, "PUT", `/tokens/${token}`, worker);
      if (status !== 200) throw new Error(`egress proxy refused the registration (${status})`);
    },
    async revoke(token) {
      await call(controlSocket, "DELETE", `/tokens/${token}`);
    },
    async decisions() {
      const response = await call(controlSocket, "GET", "/status").catch(() => null);
      if (response?.status !== 200) return null;
      try {
        const parsed = JSON.parse(response.body) as Partial<EgressDecisions>;
        return typeof parsed.allowed === "number" && typeof parsed.denied === "number"
          ? { allowed: parsed.allowed, denied: parsed.denied }
          : null;
      } catch {
        return null;
      }
    },
  };
}
