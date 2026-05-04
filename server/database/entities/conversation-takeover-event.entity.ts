import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("conversation_takeover_events")
@Index("idx_cte_org_started_at", ["organization_id", "started_at"])
@Index("idx_cte_conversation_open", ["conversation_id", "ended_at"])
@Index("idx_cte_user_started_at", ["user_id", "started_at"])
export class ConversationTakeoverEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "uuid" })
  conversation_id!: string;

  @Column({ type: "uuid" })
  user_id!: string;

  @Column({ type: "timestamptz" })
  started_at!: Date;

  @Column({ type: "timestamptz", nullable: true })
  ended_at!: Date | null;

  @Column({ type: "integer", nullable: true })
  duration_seconds!: number | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
