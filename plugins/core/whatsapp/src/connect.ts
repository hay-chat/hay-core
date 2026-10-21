import crypto from "node:crypto";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { GraphClient } from "./graph-client.js";
import type { WhatsAppConnection } from "./connection.js";
import type { PluginApi } from "./plugin-api.js";

/**
 * Finish an Embedded Signup connection (PLAN.md D5/D8).
 *
 * Core has already exchanged the 30-second ES code for a business token and
 * stored it. The dashboard forwarded the ids the signup popup reported as
 * `extras` — those are client-supplied and untrusted, so they are only used
 * after the token itself proves it can see that phone number on that WABA.
 *
 * Then: subscribe the app to the WABA's webhooks, register the number for
 * Cloud API with a per-org PIN (skipped for coexistence numbers, which stay
 * registered on the WhatsApp Business app), and hand core the routing keys
 * (`phone_number_id` for messages, `waba_id` for account-level events) plus the
 * ids/PIN to keep in the encrypted auth state.
 */

const NUMERIC_ID = /^\d{1,32}$/;

export interface ConnectResult {
  routingKeys: string[];
  account?: { label: string };
  credentials?: Record<string, string>;
  connection: WhatsAppConnection | null;
}

export interface ConnectInput {
  accessToken: string;
  extras: Record<string, unknown> | undefined;
  /** Credentials already in the auth state (a reconnect may carry the old PIN). */
  previous: Record<string, unknown> | undefined;
  graph: GraphClient;
  logger: HayLogger;
  /** Override for tests. */
  generatePin?: () => string;
}

function idFrom(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = source?.[key];
    const text = typeof value === "number" ? String(value) : value;
    if (typeof text === "string" && NUMERIC_ID.test(text)) {
      return text;
    }
  }
  return undefined;
}

function randomPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function connectEmbeddedSignup(input: ConnectInput): Promise<ConnectResult> {
  const { accessToken, extras, previous, graph, logger } = input;
  const generatePin = input.generatePin ?? randomPin;
  const notRoutable: ConnectResult = { routingKeys: [], connection: null };

  const phoneNumberId =
    idFrom(extras, "phone_number_id", "phoneNumberId") ?? idFrom(previous, "phoneNumberId");
  const wabaId = idFrom(extras, "waba_id", "wabaId") ?? idFrom(previous, "wabaId");
  const businessId = idFrom(extras, "business_id", "businessId") ?? idFrom(previous, "businessId");

  if (!phoneNumberId || !wabaId) {
    logger.warn("WhatsApp onConnected — signup did not report a phone number and WABA id");
    return notRoutable;
  }

  // The token must actually reach this number on this WABA.
  let numbers;
  try {
    numbers = await graph.listPhoneNumbers(wabaId, accessToken);
  } catch (error: unknown) {
    logger.error("WhatsApp onConnected — could not list the WABA's phone numbers", {
      wabaId,
      error: error instanceof Error ? error.message : String(error),
    });
    return notRoutable;
  }
  const number = numbers.find((candidate) => candidate.id === phoneNumberId);
  if (!number) {
    logger.error("WhatsApp onConnected — phone number is not on the WABA the token can access", {
      wabaId,
      phoneNumberId,
    });
    return notRoutable;
  }

  try {
    await graph.subscribeApp(wabaId, accessToken);
  } catch (error: unknown) {
    // Non-fatal: onStart retries, and the health card shows missing webhooks.
    logger.warn("WhatsApp onConnected — subscribing the app to the WABA failed", {
      wabaId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const credentials: Record<string, string> = { phoneNumberId, wabaId };
  if (businessId) {
    credentials.businessId = businessId;
  }

  let isCoexistence = false;
  try {
    const phone = await graph.getPhone(phoneNumberId, accessToken, [
      "is_on_biz_app",
      "platform_type",
    ]);
    isCoexistence = phone.is_on_biz_app === true;
  } catch (error: unknown) {
    logger.warn("WhatsApp onConnected — could not read the number's platform; assuming Cloud API", {
      phoneNumberId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (isCoexistence) {
    logger.info("WhatsApp onConnected — coexistence number, skipping /register", { phoneNumberId });
  } else {
    const pin =
      typeof previous?.registrationPin === "string" && /^\d{6}$/.test(previous.registrationPin)
        ? previous.registrationPin
        : generatePin();
    credentials.registrationPin = pin;
    await registerWithPin(graph, logger, phoneNumberId, accessToken, pin);
  }

  const name = number.verified_name ?? number.display_phone_number ?? phoneNumberId;
  const label = number.display_phone_number ? `${name} (${number.display_phone_number})` : name;

  return {
    routingKeys: [phoneNumberId, wabaId],
    account: { label },
    credentials,
    connection: { mode: "embedded-signup", accessToken, phoneNumberId, wabaId, businessId },
  };
}

/**
 * Without `/register` every send fails with 133010. A number that already has
 * a two-step PIN only registers with that PIN; on failure we set our PIN and
 * retry once. Failures are logged, not thrown — the health card surfaces the
 * number's status and the org can reconnect.
 */
async function registerWithPin(
  graph: GraphClient,
  logger: HayLogger,
  phoneNumberId: string,
  accessToken: string,
  pin: string,
): Promise<void> {
  try {
    await graph.registerPhone(phoneNumberId, accessToken, pin);
    logger.info("WhatsApp number registered for Cloud API", { phoneNumberId });
    return;
  } catch (error: unknown) {
    logger.warn("WhatsApp /register failed — setting the two-step PIN and retrying", {
      phoneNumberId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await graph.setTwoStepPin(phoneNumberId, accessToken, pin);
    await graph.registerPhone(phoneNumberId, accessToken, pin);
    logger.info("WhatsApp number registered for Cloud API after resetting the PIN", {
      phoneNumberId,
    });
  } catch (error: unknown) {
    logger.error("WhatsApp number registration failed", {
      phoneNumberId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Manual mode: claim the shared-webhook routing keys for a pasted token.
 *
 * When the token comes from the same Meta app whose callback is Hay's shared
 * webhook URL (self-hosters using META_* env for their own app, or Hay's own
 * test number), Meta posts to the shared URL and core needs routing keys —
 * which only OAuth's onConnected would otherwise provide. Keys are claimed only
 * after the token proves it can see the number on that WABA. Returns whether
 * routing keys were registered. Never throws.
 */
export async function registerManualRoutes(
  connection: WhatsAppConnection,
  deps: { graph: GraphClient; api: PluginApi; logger: HayLogger },
): Promise<boolean> {
  const { graph, api, logger } = deps;
  try {
    const numbers = await graph.listPhoneNumbers(connection.wabaId, connection.accessToken);
    if (!numbers.some((candidate) => candidate.id === connection.phoneNumberId)) {
      logger.warn("WhatsApp manual mode — phone number is not on the WABA the token can access", {
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
      });
      return false;
    }
    await api.mutation("webhooks.setRoutingKeys", {
      routingKeys: [connection.phoneNumberId, connection.wabaId],
    });
    return true;
  } catch (error: unknown) {
    logger.warn("WhatsApp manual mode — could not register webhook routing keys", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
