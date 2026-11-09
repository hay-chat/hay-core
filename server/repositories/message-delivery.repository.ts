import { v4 as uuidv4 } from "uuid";
import { AppDataSource } from "@server/database/data-source";
import type { MessageDeliveryKind } from "@server/database/entities/message-delivery.entity";

export interface ClaimedDelivery {
  id: string;
  kind: MessageDeliveryKind;
  organizationId: string;
  conversationId: string;
  attempts: number;
  lastError: string | null;
}

const RETURNING = `RETURNING id, kind, organization_id AS "organizationId",
  conversation_id AS "conversationId", attempts, last_error AS "lastError"`;

/** Repeated status writes for one handoff within this window queue a single /escalate. */
const ESCALATION_DEDUPE_SECONDS = 60;

/**
 * Raw SQL on purpose: claiming needs FOR UPDATE SKIP LOCKED. TypeORM's postgres
 * driver returns `[rows, affectedCount]` for UPDATE ... RETURNING and a flat
 * array for INSERT ... RETURNING.
 */
class MessageDeliveryRepository {
  /** Returns false when this message is already queued. */
  async insertMessage(args: {
    messageId: string;
    organizationId: string;
    conversationId: string;
  }): Promise<boolean> {
    const rows: unknown[] = await AppDataSource.query(
      `INSERT INTO message_deliveries (id, kind, organization_id, conversation_id)
       VALUES ($1, 'message', $2, $3)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [args.messageId, args.organizationId, args.conversationId],
    );
    return rows.length > 0;
  }

  /** Returns the new delivery id, or null when this handoff was just queued. */
  async insertEscalation(args: {
    organizationId: string;
    conversationId: string;
  }): Promise<string | null> {
    const rows: Array<{ id: string }> = await AppDataSource.query(
      `INSERT INTO message_deliveries (id, kind, organization_id, conversation_id)
       SELECT $1::uuid, 'escalation', $2::uuid, $3::uuid
       WHERE NOT EXISTS (
         SELECT 1 FROM message_deliveries
         WHERE conversation_id = $3::uuid AND kind = 'escalation'
           AND created_at > now() - make_interval(secs => $4)
       )
       RETURNING id`,
      [uuidv4(), args.organizationId, args.conversationId, ESCALATION_DEDUPE_SECONDS],
    );
    return rows[0]?.id ?? null;
  }

  /** Take a pending delivery for this consumer; null when another one has it or it is done. */
  async claim(id: string): Promise<ClaimedDelivery | null> {
    const [rows]: [ClaimedDelivery[], number] = await AppDataSource.query(
      `UPDATE message_deliveries
       SET status = 'processing', attempts = attempts + 1, claimed_at = now(), updated_at = now()
       WHERE id = (
         SELECT id FROM message_deliveries
         WHERE id = $1 AND status = 'pending'
         FOR UPDATE SKIP LOCKED
       )
       ${RETURNING}`,
      [id],
    );
    return rows[0] ?? null;
  }

  async markDelivered(id: string): Promise<void> {
    await AppDataSource.query(
      `UPDATE message_deliveries
       SET status = 'delivered', claimed_at = NULL, last_error = NULL, updated_at = now()
       WHERE id = $1`,
      [id],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await AppDataSource.query(
      `UPDATE message_deliveries
       SET status = 'failed', claimed_at = NULL, last_error = $2, updated_at = now()
       WHERE id = $1`,
      [id, error],
    );
  }

  async scheduleRetry(id: string, delayMs: number, error: string): Promise<void> {
    await AppDataSource.query(
      `UPDATE message_deliveries
       SET status = 'pending', claimed_at = NULL, last_error = $3, updated_at = now(),
           next_attempt_at = now() + make_interval(secs => $2::float / 1000)
       WHERE id = $1`,
      [id, delayMs, error],
    );
  }

  /** Move a failed delivery to dead once; null when it was already handled. */
  async markDead(id: string): Promise<ClaimedDelivery | null> {
    const [rows]: [ClaimedDelivery[], number] = await AppDataSource.query(
      `UPDATE message_deliveries SET status = 'dead', updated_at = now()
       WHERE id = $1 AND status = 'failed'
       ${RETURNING}`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Pending deliveries due for at least `graceMs` (their queue message was lost
   * or never published). Pushes each one's due time forward so the next sweep
   * does not publish it again while the queue is working through it.
   */
  async takeDue(graceMs: number, limit: number): Promise<string[]> {
    const [rows]: [Array<{ id: string }>, number] = await AppDataSource.query(
      `UPDATE message_deliveries
       SET next_attempt_at = now(), updated_at = now()
       WHERE id IN (
         SELECT id FROM message_deliveries
         WHERE status = 'pending'
           AND next_attempt_at <= now() - make_interval(secs => $1::float / 1000)
         ORDER BY next_attempt_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      [graceMs, limit],
    );
    return rows.map((row) => row.id);
  }

  /** Give up on claims whose server died mid-call: the provider may already have the message. */
  async failStaleClaims(olderThanMs: number): Promise<ClaimedDelivery[]> {
    const [rows]: [ClaimedDelivery[], number] = await AppDataSource.query(
      `UPDATE message_deliveries
       SET status = 'failed', claimed_at = NULL, last_error = 'delivery_interrupted', updated_at = now()
       WHERE status = 'processing'
         AND claimed_at < now() - make_interval(secs => $1::float / 1000)
       ${RETURNING}`,
      [olderThanMs],
    );
    return rows;
  }

  async deleteSettledOlderThan(days: number): Promise<void> {
    await AppDataSource.query(
      `DELETE FROM message_deliveries
       WHERE status IN ('delivered', 'failed', 'dead')
         AND updated_at < now() - make_interval(days => $1)`,
      [days],
    );
  }
}

export const messageDeliveryRepository = new MessageDeliveryRepository();
