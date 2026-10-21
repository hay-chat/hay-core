/**
 * The WhatsApp number a worker is serving, resolved on start, on connect and on
 * config changes. Two ways to connect (PLAN.md D5/D6):
 *
 *  - Embedded Signup: the business token lives in the OAuth auth state; the
 *    phone number / WABA ids and registration PIN were stored alongside it by
 *    `onConnected` (returned as `credentials`). Webhooks arrive on the shared
 *    URL, verified and routed by core.
 *  - Manual: the org pasted a permanent system-user token from its own Meta
 *    app. Webhooks arrive on the per-org URL and the worker verifies them with
 *    that app's secret and verify token.
 */

export type ConnectionMode = "embedded-signup" | "manual";

export interface WhatsAppConnection {
  mode: ConnectionMode;
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  /** Business portfolio id, when Embedded Signup reported it. */
  businessId?: string;
  /** Manual mode only: the org's own Meta app secret, for webhook signatures. */
  appSecret?: string;
  /** Manual mode only: the verify token set in the org's own Meta app. */
  verifyToken?: string;
}

type Values = Record<string, unknown>;

function str(values: Values | undefined, key: string): string | undefined {
  const value = values?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Resolve the active connection from the org's config and OAuth credentials.
 * Returns null while the channel is not (fully) connected.
 */
export function resolveConnection(
  config: Values,
  credentials: Values | undefined,
): WhatsAppConnection | null {
  if (str(config, "connectionMode") === "manual") {
    const accessToken = str(config, "manualAccessToken");
    const phoneNumberId = str(config, "manualPhoneNumberId");
    const wabaId = str(config, "manualWabaId");
    if (!accessToken || !phoneNumberId || !wabaId) {
      return null;
    }
    return {
      mode: "manual",
      accessToken,
      phoneNumberId,
      wabaId,
      appSecret: str(config, "manualAppSecret"),
      verifyToken: str(config, "manualVerifyToken"),
    };
  }

  const accessToken = str(credentials, "accessToken");
  const phoneNumberId = str(credentials, "phoneNumberId");
  const wabaId = str(credentials, "wabaId");
  if (!accessToken || !phoneNumberId || !wabaId) {
    return null;
  }
  return {
    mode: "embedded-signup",
    accessToken,
    phoneNumberId,
    wabaId,
    businessId: str(credentials, "businessId"),
  };
}
