import crypto from "crypto";
import { config } from "@server/config/env";
import { AppDataSource } from "@server/database/data-source";
import { OperatorEventRecord } from "@server/database/entities/operator-event.entity";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("operator-events");

const TIMEOUT_MS = 10_000;
const MINUTE_MS = 60 * 1000;

/**
 * Wait before retry n (G3), after the inline attempt failed: 1 min, 5 min,
 * 30 min, 2 h, 6 h, 24 h. Seven attempts over about 33 hours, then the event
 * is marked failed and logged as an error for someone to act on by hand.
 */
export const RETRY_DELAYS_MS = [1, 5, 30, 120, 360, 1440].map((minutes) => minutes * MINUTE_MS);
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** A claimed retry is not picked up again for this long (covers the fetch timeout). */
const LEASE_MS = 2 * MINUTE_MS;

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

function operatorConfig(): { url: string; secret: string } | null {
  const url = config.internal.operatorEventsUrl;
  const secret = config.internal.apiSecret;
  return url && secret ? { url, secret } : null;
}

/**
 * One signed POST; returns null when delivered, else the error. Signed per
 * attempt: the receiver rejects old timestamps.
 */
async function deliver(
  event: OperatorEvent,
  target: { url: string; secret: string },
): Promise<string | null> {
  const body = JSON.stringify(event);
  try {
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hay-signature": signOperatorEvent(body, target.secret),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? null : `HTTP ${response.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * POST the event to OPERATOR_EVENTS_URL, signed with INTERNAL_API_SECRET.
 * A no-op unless both are set (the self-hosting default). Never throws: the
 * action that raised the event has already happened. A failed delivery is
 * stored and retried by `retryOperatorEvents` (G3).
 */
export async function notifyOperator(event: OperatorEvent): Promise<boolean> {
  const target = operatorConfig();
  if (!target) return false;

  const error = await deliver(event, target);
  if (error === null) return true;

  logger.error(
    { event: event.event, organizationId: event.organizationId, error },
    "Could not deliver the event to the operator; will retry",
  );
  try {
    await AppDataSource.getRepository(OperatorEventRecord).insert({
      event: event.event,
      organization_id: event.organizationId,
      payload: event,
      attempts: 1,
      next_attempt_at: new Date(Date.now() + RETRY_DELAYS_MS[0]),
      last_error: error.slice(0, 2000),
    });
  } catch (storeError) {
    logger.error(
      { err: storeError, event: event.event, organizationId: event.organizationId },
      "Could not store the operator event for retry",
    );
  }
  return false;
}

/**
 * Scheduler (`operator-event-retry`): lease up to `limit` due events, retry
 * each once, then reschedule with the next delay or give up after
 * MAX_ATTEMPTS. Does nothing while the operator is not configured, so the
 * events wait for the configuration to come back.
 */
export async function retryOperatorEvents(
  limit = 10,
): Promise<{ delivered: number; rescheduled: number; failed: number }> {
  const summary = { delivered: 0, rescheduled: 0, failed: 0 };
  const target = operatorConfig();
  if (!target) return summary;

  const [rows]: [Array<{ id: string; attempts: number; payload: OperatorEvent }>, number] =
    await AppDataSource.query(
      `UPDATE operator_events
       SET next_attempt_at = now() + ($2 || ' milliseconds')::interval,
           attempts = attempts + 1,
           updated_at = now()
       WHERE id IN (
         SELECT id FROM operator_events
         WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
         ORDER BY next_attempt_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, attempts, payload`,
      [limit, String(LEASE_MS)],
    );
  if (!rows?.length) return summary;

  const repository = AppDataSource.getRepository(OperatorEventRecord);
  for (const row of rows) {
    const error = await deliver(row.payload, target);
    const log = {
      eventId: row.id,
      organizationId: row.payload.organizationId,
      attempt: row.attempts,
    };
    if (error === null) {
      await repository.update(
        { id: row.id },
        { delivered_at: new Date(), next_attempt_at: null, last_error: null },
      );
      logger.info(log, "Operator event delivered on retry");
      summary.delivered++;
    } else if (row.attempts >= MAX_ATTEMPTS) {
      await repository.update(
        { id: row.id },
        { failed_at: new Date(), next_attempt_at: null, last_error: error.slice(0, 2000) },
      );
      logger.error(
        { ...log, error: error },
        "Operator event undelivered after every retry; act on it by hand",
      );
      summary.failed++;
    } else {
      await repository.update(
        { id: row.id },
        {
          next_attempt_at: new Date(Date.now() + RETRY_DELAYS_MS[row.attempts - 1]),
          last_error: error.slice(0, 2000),
        },
      );
      logger.warn({ ...log, error: error }, "Operator event retry failed; rescheduled");
      summary.rescheduled++;
    }
  }
  return summary;
}
