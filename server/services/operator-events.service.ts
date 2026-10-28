import crypto from "crypto";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("operator-events");

const TIMEOUT_MS = 10_000;

/**
 * Events an external operator (e.g. a hosted-plan backoffice) may need to act
 * on. Core only reports what happened; what to do about billing is the
 * operator's business.
 */
export type OperatorEvent = {
  event: "organization.deleted";
  organizationId: string;
  occurredAt: string;
};

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` keyed with INTERNAL_API_SECRET. */
export function signOperatorEvent(body: string, secret: string, now = Date.now()): string {
  const timestamp = Math.floor(now / 1000);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/**
 * POST the event to OPERATOR_EVENTS_URL, signed with INTERNAL_API_SECRET.
 * A no-op unless both are set (the self-hosting default). Never throws: the
 * action that raised the event has already happened.
 */
export async function notifyOperator(event: OperatorEvent): Promise<boolean> {
  const url = config.internal.operatorEventsUrl;
  const secret = config.internal.apiSecret;
  if (!url || !secret) return false;

  const body = JSON.stringify(event);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hay-signature": signOperatorEvent(body, secret),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.error(
        { event: event.event, organizationId: event.organizationId, status: response.status },
        "Operator rejected the event",
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.error(
      { err: error, event: event.event, organizationId: event.organizationId },
      "Could not deliver the event to the operator",
    );
    return false;
  }
}
