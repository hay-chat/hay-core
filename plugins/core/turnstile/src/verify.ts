/**
 * Turnstile gate decision logic, kept free of SDK wiring so it can be tested
 * with a stubbed fetch.
 *
 * Policy (Roger's answers, D9 research): never lock shoppers out because the
 * provider is down. Provider or widget failures flag the conversation; only a
 * token Cloudflare positively rejects, or a missing token while everyone must
 * be challenged (whatever error the client reports), is a deny.
 */

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const SITEVERIFY_TIMEOUT_MS = 3000;
export const EXPECTED_ACTION = "conversation_create";

export type TurnstileMode = "off" | "invisible" | "challenge_all";

export interface GateSettings {
  siteKey?: string;
  secretKey?: string;
  mode: TurnstileMode;
}

export interface GateRequest {
  token?: string;
  contributionError?: string;
  frameHostname: string;
  ip?: string;
  underAttack: boolean;
}

export interface GateDecision {
  decision: "allow" | "deny" | "flag";
  reason?: string;
}

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
  metadata?: { result_with_testing_key?: boolean };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function normalizeMode(value: unknown): TurnstileMode {
  return value === "off" || value === "challenge_all" ? value : "invisible";
}

export async function decide(
  settings: GateSettings,
  request: GateRequest,
  fetchImpl: FetchLike = fetch,
): Promise<GateDecision> {
  // No site key: the widget was never sent a challenge. Feature unavailable.
  if (!settings.siteKey) return { decision: "allow", reason: "not_configured" };
  if (settings.mode === "off" && !request.underAttack) return { decision: "allow" };
  // A challenge was served but cannot be verified: misconfiguration, not the shopper's fault.
  if (!settings.secretKey) return { decision: "flag", reason: "secret_missing" };

  const mustChallenge = settings.mode === "challenge_all" || request.underAttack;

  if (!request.token) {
    // When everyone must be challenged, a client-reported error is not proof of
    // anything (any client can send one), so no token is always a deny.
    if (mustChallenge) return { decision: "deny", reason: "token_missing" };
    // The widget tried and the provider failed (script blocked, timeout…).
    if (request.contributionError) {
      return { decision: "flag", reason: `challenge_error:${request.contributionError}`.slice(0, 100) };
    }
    // No token and no explanation: an old widget or a client skipping the challenge.
    return { decision: "flag", reason: "token_missing" };
  }

  let body: SiteverifyResponse;
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: settings.secretKey,
        response: request.token,
        ...(request.ip ? { remoteip: request.ip } : {}),
      }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { decision: "flag", reason: "provider_unavailable" };
    body = (await response.json()) as SiteverifyResponse;
  } catch {
    return { decision: "flag", reason: "provider_unavailable" };
  }

  if (!body.success) {
    const codes = body["error-codes"] ?? [];
    if (codes.includes("internal-error")) return { decision: "flag", reason: "provider_unavailable" };
    // Misconfigured secret is our problem, not the shopper's.
    if (codes.some((code) => code.includes("secret"))) {
      return { decision: "flag", reason: "secret_invalid" };
    }
    return { decision: "deny", reason: "invalid_token" };
  }

  // Cloudflare's published test keys report hostname "example.com" and no
  // action, so the binding checks only apply to real keys.
  if (body.metadata?.result_with_testing_key) return { decision: "allow", reason: "testing_key" };

  if ((body.hostname ?? "").toLowerCase() !== request.frameHostname.toLowerCase()) {
    return { decision: "deny", reason: "hostname_mismatch" };
  }
  if (body.action !== EXPECTED_ACTION) return { decision: "deny", reason: "action_mismatch" };
  return { decision: "allow" };
}
