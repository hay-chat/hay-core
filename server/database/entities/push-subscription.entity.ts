import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "../../entities/user.entity";

/**
 * A browser's Web Push subscription for one dashboard user. One row per device
 * (the push endpoint is unique). Not scoped to an organization: the device gets
 * the alerts of every organization its user is an active member of. Rows are
 * deleted on logout, on opt-out, and when the push service answers 404/410
 * (subscription expired or revoked by the user).
 */
@Entity("push_subscriptions")
@Index("idx_push_subscriptions_user", ["user_id"])
export class PushSubscription {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  user_id!: string;

  @Column({ type: "text", unique: true })
  endpoint!: string;

  @Column({ type: "text" })
  p256dh!: string;

  @Column({ type: "text" })
  auth!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  user_agent!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;
}
