import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import type { SimulationExpectations, SimulationSeedTurn } from "./simulation-run-item.entity";

/** Where a test case was saved from. */
export const TEST_CASE_SOURCES = [
  "replay",
  "approval_edit",
  "approval_block",
  "feedback",
  "conversation",
  "insight",
] as const;
export type TestCaseSource = (typeof TEST_CASE_SOURCES)[number];

/**
 * A saved test case (D7-12): a conversation up to a shopper message and what a
 * good answer looks like (the reply to match or avoid, the expected outcome,
 * tools, hand-off). A playbook's cases run before its draft is published.
 * Like imported transcripts, deleted after the organization's retention.
 */
@Entity("test_cases")
@Index("idx_test_cases_org_created", ["organization_id", "created_at"])
@Index("idx_test_cases_org_playbook", ["organization_id", "playbook_id"])
export class TestCase {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  /** The conversation up to and including the shopper message to answer. */
  @Column({ type: "jsonb" })
  seed!: SimulationSeedTurn[];

  @Column({ type: "jsonb", default: () => "'{}'" })
  expectations!: SimulationExpectations;

  @Column({ type: "varchar", length: 32 })
  source!: TestCaseSource;

  /** The run item, message or insight issue it was saved from. */
  @Column({ type: "varchar", length: 255, nullable: true })
  source_ref!: string | null;

  /** The playbook whose drafts this case checks; null = runs with every playbook's. */
  @Column({ type: "uuid", nullable: true })
  playbook_id!: string | null;

  @Column({ type: "uuid", nullable: true })
  created_by_id!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
