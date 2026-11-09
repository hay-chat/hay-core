/**
 * The egress proxy: the only thing plugin workers can reach the internet
 * through. HTTP and CONNECT only, no TLS interception, deny by default.
 *
 * A worker identifies itself with the token in its proxy URL
 * (Proxy-Authorization: Basic hay:<token>). The proxy resolves the name itself,
 * checks every address it got, and connects to an address it checked, so a
 * name that changes between check and connect gains nothing.
 */
import http, { type IncomingMessage, type ServerResponse } from "http";
import net, { isIP, type Socket } from "net";
import dns from "dns";
import { parseAllowRule, isAllowed, isBlockedAddress, type AllowRule } from "./egress-policy";
import { log } from "./log";

export interface WorkerGrant {
  pluginId: string;
  orgId: string;
  allow: string[];
}

interface Grant {
  pluginId: string;
  orgId: string;
  rules: AllowRule[];
  active: number;
}

export interface EgressLimits {
  maxConnectionsPerWorker: number;
  idleTimeoutMs: number;
  maxDurationMs: number;
}

export const DEFAULT_LIMITS: EgressLimits = {
  maxConnectionsPerWorker: 64,
  idleTimeoutMs: 120_000,
  maxDurationMs: 15 * 60_000,
};

type Lookup = (host: string) => Promise<string[]>;
/** Opens the connection to an address the proxy already validated. Replaceable in tests. */
type Connect = (address: string, port: number) => Socket;

const systemLookup: Lookup = async (host) => {
  const results = await dns.promises.lookup(host, { all: true, verbatim: true });
  return results.map((result) => result.address);
};

export class EgressProxy {
  private readonly grants = new Map<string, Grant>();
  readonly decisions = { allowed: 0, denied: 0 };

  constructor(
    private readonly limits: EgressLimits = DEFAULT_LIMITS,
    private readonly lookup: Lookup = systemLookup,
    private readonly connect: Connect = (address, port) => net.connect({ host: address, port }),
  ) {}

  grant(token: string, worker: WorkerGrant): void {
    const rules = worker.allow
      .map(parseAllowRule)
      .filter((rule): rule is AllowRule => rule !== null);
    this.grants.set(token, { pluginId: worker.pluginId, orgId: worker.orgId, rules, active: 0 });
  }

  revoke(token: string): void {
    this.grants.delete(token);
  }

  createServer(): http.Server {
    const server = http.createServer((req, res) => void this.handleHttp(req, res));
    server.on("connect", (req, socket: Socket, head) => void this.handleConnect(req, socket, head));
    return server;
  }

  private identify(req: IncomingMessage): Grant | null {
    const header = req.headers["proxy-authorization"];
    if (typeof header !== "string" || !header.startsWith("Basic ")) return null;
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const token = decoded.slice(decoded.indexOf(":") + 1);
    return this.grants.get(token) ?? null;
  }

  /**
   * Decide whether `host:port` may be reached and, if so, which address to
   * connect to. Every address the name resolves to must be public.
   */
  private async authorize(
    grant: Grant | null,
    host: string,
    port: number,
    kind: string,
  ): Promise<{ address: string } | { denied: string }> {
    const deny = (reason: string): { denied: string } => {
      this.decisions.denied++;
      log.warn("egress deny", {
        kind,
        pluginId: grant?.pluginId,
        orgId: grant?.orgId,
        host,
        port,
        reason,
      });
      return { denied: reason };
    };
    if (!grant) return deny("unknown worker");
    if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) return deny("ip literal");
    const name = host.toLowerCase().replace(/\.$/, "");
    if (!isAllowed(grant.rules, name, port)) return deny("host not declared by the plugin");
    let addresses: string[];
    try {
      addresses = await this.lookup(name);
    } catch {
      return deny("name did not resolve");
    }
    if (addresses.length === 0) return deny("name did not resolve");
    const internal = addresses.find(isBlockedAddress);
    if (internal) return deny(`resolves to a non-public address (${internal})`);
    if (grant.active >= this.limits.maxConnectionsPerWorker) return deny("too many connections");
    this.decisions.allowed++;
    log.info("egress allow", {
      kind,
      pluginId: grant.pluginId,
      orgId: grant.orgId,
      host,
      port,
    });
    return { address: addresses[0] };
  }

  private async handleConnect(req: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    client.on("error", () => client.destroy());
    const grant = this.identify(req);
    const target = /^(.+):(\d{1,5})$/.exec(req.url ?? "");
    if (!target) {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const result = await this.authorize(grant, target[1], Number(target[2]), "connect");
    if ("denied" in result) {
      client.end(`HTTP/1.1 403 Forbidden\r\n\r\n${result.denied}`);
      return;
    }
    grant!.active++;
    const upstream = this.connect(result.address, Number(target[2]));
    let closed = false;
    const closeOnce = (): void => {
      if (closed) return;
      closed = true;
      grant!.active--;
      upstream.destroy();
      client.destroy();
    };
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", closeOnce);
    upstream.on("close", closeOnce);
    client.on("close", closeOnce);
    for (const socket of [upstream, client])
      socket.setTimeout(this.limits.idleTimeoutMs, closeOnce);
    setTimeout(closeOnce, this.limits.maxDurationMs).unref();
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const grant = this.identify(req);
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.protocol !== "http:") {
      res.writeHead(400).end();
      return;
    }
    const port = url.port ? Number(url.port) : 80;
    const result = await this.authorize(grant, url.hostname, port, "http");
    if ("denied" in result) {
      res.writeHead(403, { "content-type": "text/plain" }).end(result.denied);
      return;
    }
    grant!.active++;
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const upstream = http.request(
      {
        createConnection: () => this.connect(result.address, port),
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, host: url.host },
        timeout: this.limits.idleTimeoutMs,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        grant!.active--;
      }
    };
    res.on("close", release);
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      release();
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
    req.pipe(upstream);
  }
}
