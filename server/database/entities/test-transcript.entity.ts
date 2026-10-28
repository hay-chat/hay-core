import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from "typeorm";
import type { TestTranscriptTurn } from "@server/services/importers/transcripts/test-transcript";

/**
 * A past conversation imported from another tool (D7-8), stored in the
 * neutral TestTranscript shape for replays and test cases. Deleted after the
 * organization's `settings.retentionDays`, like conversations.
 */
@Entity("test_transcripts")
@Index("idx_test_transcripts_org_created", ["organization_id", "created_at"])
@Index("idx_test_transcripts_org_batch", ["organization_id", "import_batch_id"])
export class TestTranscript {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  /** Where it came from: "csv", "paste", "whatsapp", "tidio", "gorgias"... */
  @Column({ type: "varchar", length: 32 })
  source!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  external_id!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  title!: string | null;

  @Column({ type: "jsonb" })
  turns!: TestTranscriptTurn[];

  @Column({ type: "varchar", length: 255, nullable: true })
  order_ref!: string | null;

  @Column({ type: "integer" })
  turn_count!: number;

  /** When the conversation happened, when the source says. */
  @Column({ type: "timestamptz", nullable: true })
  started_at!: Date | null;

  /** Every transcript of one import shares this id. */
  @Column({ type: "uuid" })
  import_batch_id!: string;

  @Column({ type: "uuid", nullable: true })
  created_by_id!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;
}
