import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { config } from "@server/config/env";
import { safeFetch } from "@server/utils/ssrf";

/**
 * OpenID Connect authorization code flow with PKCE, for a provider an
 * organization owner configured. Everything the provider returns is untrusted
 * until the ID token's signature, issuer, audience, expiry and nonce check out.
 */

const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const CLOCK_TOLERANCE_SECONDS = 60;
/** Asymmetric algorithms only: a shared-secret or `none` token is never accepted. */
const ALLOWED_ALGORITHMS: jwt.Algorithm[] = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
];

export class OidcError extends Error {
  constructor(
    public readonly code:
      | "discovery_failed"
      | "token_exchange_failed"
      | "token_invalid"
      | "issuer_mismatch"
      | "nonce_mismatch"
      | "email_unverified"
      | "email_missing",
    message: string,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

export interface ProviderMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  nonce?: string;
  azp?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  [claim: string]: unknown;
}

export function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, "");
}

/** Providers are reached over https; plain http only where private hosts are allowed on purpose. */
export function assertAcceptableProviderUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OidcError("discovery_failed", "Provider URL is not valid");
  }
  const allowPlain = config.sso.allowPrivateProviderHosts && url.protocol === "http:";
  if (url.protocol !== "https:" && !allowPlain) {
    throw new OidcError("discovery_failed", "Provider URLs must use https");
  }
  if (url.username || url.password || url.hash) {
    throw new OidcError("discovery_failed", "Provider URL is not valid");
  }
  return url;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  assertAcceptableProviderUrl(url);
  // Redirects are never followed: a provider answering with one is misconfigured.
  const response = config.sso.allowPrivateProviderHosts
    ? await fetch(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    : await safeFetch(url, { ...init, timeoutMs: FETCH_TIMEOUT_MS });
  return response;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Response is too large");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Response is too large");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Response is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function endpoint(document: Record<string, unknown>, name: string): string {
  const value = document[name];
  if (typeof value !== "string") throw new OidcError("discovery_failed", `Missing ${name}`);
  assertAcceptableProviderUrl(value);
  return value;
}

/** Reads `<issuer>/.well-known/openid-configuration` and checks it describes the same issuer. */
export async function discoverProvider(issuer: string): Promise<ProviderMetadata> {
  const expected = normalizeIssuer(issuer);
  try {
    const response = await request(`${expected}/.well-known/openid-configuration`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok)
      throw new OidcError("discovery_failed", `Discovery answered ${response.status}`);
    const document = await readJson(response);
    if (typeof document.issuer !== "string" || normalizeIssuer(document.issuer) !== expected) {
      throw new OidcError("issuer_mismatch", "Discovery document names a different issuer");
    }
    const methods = document.code_challenge_methods_supported;
    if (Array.isArray(methods) && !methods.includes("S256")) {
      throw new OidcError("discovery_failed", "Provider does not support PKCE S256");
    }
    return {
      issuer: expected,
      authorizationEndpoint: endpoint(document, "authorization_endpoint"),
      tokenEndpoint: endpoint(document, "token_endpoint"),
      jwksUri: endpoint(document, "jwks_uri"),
    };
  } catch (error) {
    if (error instanceof OidcError) throw error;
    throw new OidcError("discovery_failed", "Could not read the provider's configuration");
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizationUrl(params: {
  provider: ProviderMetadata;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  loginHint?: string;
}): string {
  const url = new URL(params.provider.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", pkceChallenge(params.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);
  return url.toString();
}

/** Trades the authorization code for an ID token. The access token is not used. */
export async function exchangeCode(params: {
  provider: ProviderMetadata;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<string> {
  const basic = Buffer.from(
    `${encodeURIComponent(params.clientId)}:${encodeURIComponent(params.clientSecret)}`,
  ).toString("base64");
  try {
    const response = await request(params.provider.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
      }).toString(),
    });
    if (!response.ok) {
      throw new OidcError("token_exchange_failed", `Token endpoint answered ${response.status}`);
    }
    const body = await readJson(response);
    if (typeof body.id_token !== "string" || body.id_token.length === 0) {
      throw new OidcError("token_exchange_failed", "Token response has no ID token");
    }
    return body.id_token;
  } catch (error) {
    if (error instanceof OidcError) throw error;
    throw new OidcError("token_exchange_failed", "Token exchange failed");
  }
}

async function fetchSigningKeys(jwksUri: string): Promise<crypto.JsonWebKey[]> {
  try {
    const response = await request(jwksUri, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`JWKS answered ${response.status}`);
    const body = await readJson(response);
    if (!Array.isArray(body.keys)) throw new Error("JWKS has no keys");
    return body.keys.filter(
      (key): key is crypto.JsonWebKey =>
        !!key && typeof key === "object" && (key.use === undefined || key.use === "sig"),
    );
  } catch {
    throw new OidcError("token_invalid", "Could not read the provider's signing keys");
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Checks signature (against the provider's published keys), issuer, audience,
 * expiry and nonce, and returns the claims. Throws OidcError otherwise.
 */
export async function verifyIdToken(params: {
  idToken: string;
  provider: ProviderMetadata;
  clientId: string;
  nonce: string;
}): Promise<IdTokenClaims> {
  const decoded = jwt.decode(params.idToken, { complete: true });
  const header = decoded?.header;
  if (!header || !ALLOWED_ALGORITHMS.includes(header.alg as jwt.Algorithm)) {
    throw new OidcError("token_invalid", "ID token uses an unsupported algorithm");
  }

  const keys = await fetchSigningKeys(params.provider.jwksUri);
  const candidates = header.kid
    ? keys.filter((key) => (key as { kid?: string }).kid === header.kid)
    : keys.length === 1
      ? keys
      : [];
  if (candidates.length !== 1) {
    throw new OidcError("token_invalid", "No signing key matches the ID token");
  }

  let claims: IdTokenClaims;
  try {
    const key = crypto.createPublicKey({ key: candidates[0], format: "jwk" });
    claims = jwt.verify(params.idToken, key, {
      algorithms: [header.alg as jwt.Algorithm],
      issuer: params.provider.issuer,
      audience: params.clientId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }) as IdTokenClaims;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError && error.message.startsWith("jwt issuer invalid")) {
      throw new OidcError("issuer_mismatch", "ID token was issued by a different issuer");
    }
    throw new OidcError("token_invalid", "ID token is not valid");
  }

  if (typeof claims.exp !== "number") {
    throw new OidcError("token_invalid", "ID token has no expiry");
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 255) {
    throw new OidcError("token_invalid", "ID token has no usable subject");
  }
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== params.clientId) {
    throw new OidcError("token_invalid", "ID token was issued to another party as well");
  }
  if (typeof claims.nonce !== "string" || !safeEqual(claims.nonce, params.nonce)) {
    throw new OidcError("nonce_mismatch", "ID token nonce does not match this sign-in");
  }
  return claims;
}

/** The provider's verified email address, lowercased. A claim it has not verified is refused. */
export function verifiedEmail(claims: IdTokenClaims): string {
  if (typeof claims.email !== "string" || !claims.email.includes("@")) {
    throw new OidcError("email_missing", "ID token has no email address");
  }
  if (claims.email_verified !== true) {
    throw new OidcError("email_unverified", "The provider has not verified this email address");
  }
  return claims.email.trim().toLowerCase();
}

/** Values of a claim as strings: a string, or a list of strings. */
export function claimValues(claims: IdTokenClaims, name: string): string[] {
  const value = claims[name];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}
