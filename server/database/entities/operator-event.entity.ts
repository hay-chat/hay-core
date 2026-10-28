import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * An operator event whose first delivery failed (G3), retried with backoff by
 * the `operator-event-retry` job until delivered or out of attempts.
 *
 * No foreign key to organizations: the event usually reports that the
 * organization was just deleted.
 */
@Entity("operator_events")
@Index("idx_operator_events_due", ["next_attempt_at"], {
  where: `"delivered_at" IS NULL AND "failed_at" IS NULL`,
})
export class OperatorEventRecord {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 64 })
  event!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  /** The event as POSTed (re-signed on every attempt). */
  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  /** Attempts made so far, the first inline one included. */
  @Column({ type: "int", default: 0 })
  attempts!: number;

  /** When the next attempt is due; also the lease while one is running. */
  @Column({ type: "timestamptz", nullable: true })
  next_attempt_at!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  delivered_at!: Date | null;

  /** Set when the last attempt failed: someone has to act on the event by hand. */
  @Column({ type: "timestamptz", nullable: true })
  failed_at!: Date | null;

  @Column({ type: "text", nullable: true })
  last_error!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
