import * as crypto from "crypto";
import * as http from "http";
import type { AddressInfo } from "net";
import * as jwt from "jsonwebtoken";

export interface FakeLoginOverrides {
  /** Claims placed in the ID token, over the defaults. */
  claims?: Record<string, unknown>;
  /** Replaces the nonce the browser asked for. */
  nonce?: string;
  /** Replaces the issuer the token is signed with. */
  issuer?: string;
  /** Replaces the audience. */
  audience?: string;
  /** Signs with a different key than the one published. */
  signWithOtherKey?: boolean;
  /** Seconds relative to now. */
  expiresIn?: number;
}

interface PendingCode {
  nonce: string;
  codeChallenge: string;
  clientId: string;
  overrides: FakeLoginOverrides;
}

/**
 * A minimal OpenID Connect provider on a loopback port: discovery, keys, and a
 * token endpoint that checks the client secret and the PKCE verifier. `login`
 * stands in for the person authenticating at the provider.
 */
export class FakeOidcProvider {
  readonly clientId = "hay-test-client";
  readonly clientSecret = "hay-test-client-secret";
  /** Written into the discovery document; tests can change it to simulate a misconfiguration. */
  discoveryIssuer = "";
  issuer = "";
  private server!: http.Server;
  private codes = new Map<string, PendingCode>();
  private readonly keyPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  private readonly otherKeyPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  private readonly kid = "test-key-1";
  tokenRequests = 0;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    this.discoveryIssuer = this.issuer;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** The person signs in at the provider; returns the redirect back to the application. */
  login(
    authorizationUrl: string,
    overrides: FakeLoginOverrides = {},
  ): { code: string; state: string } {
    const url = new URL(authorizationUrl);
    const code = crypto.randomBytes(16).toString("hex");
    this.codes.set(code, {
      nonce: url.searchParams.get("nonce") ?? "",
      codeChallenge: url.searchParams.get("code_challenge") ?? "",
      clientId: url.searchParams.get("client_id") ?? "",
      overrides,
    });
    return { code, state: url.searchParams.get("state") ?? "" };
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: this.discoveryIssuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/keys`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (req.url === "/keys") {
      const jwk = this.keyPair.publicKey.export({ format: "jwk" });
      return json(200, { keys: [{ ...jwk, kid: this.kid, use: "sig", alg: "RS256" }] });
    }
    if (req.url === "/token" && req.method === "POST") {
      this.tokenRequests += 1;
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => this.token(req, body, json));
      return;
    }
    json(404, { error: "not_found" });
  }

  private token(
    req: http.IncomingMessage,
    body: string,
    json: (status: number, body: unknown) => void,
  ): void {
    const form = new URLSearchParams(body);
    const basic = Buffer.from(
      (req.headers.authorization ?? "").replace(/^Basic /, ""),
      "base64",
    ).toString();
    const [id, secret] = basic.split(":").map(decodeURIComponent);
    const pending = this.codes.get(form.get("code") ?? "");
    this.codes.delete(form.get("code") ?? "");
    if (!pending || id !== this.clientId || secret !== this.clientSecret) {
      return json(400, { error: "invalid_client" });
    }
    const verifier = form.get("code_verifier") ?? "";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    if (challenge !== pending.codeChallenge) return json(400, { error: "invalid_grant" });

    const { overrides } = pending;
    const idToken = jwt.sign(
      {
        sub: "subject-1",
        email: "person@example.test",
        email_verified: true,
        nonce: overrides.nonce ?? pending.nonce,
        ...overrides.claims,
      },
      (overrides.signWithOtherKey ? this.otherKeyPair : this.keyPair).privateKey,
      {
        algorithm: "RS256",
        keyid: this.kid,
        issuer: overrides.issuer ?? this.issuer,
        audience: overrides.audience ?? pending.clientId,
        expiresIn: overrides.expiresIn ?? 300,
      },
    );
    json(200, { access_token: "unused", token_type: "Bearer", id_token: idToken });
  }
}
