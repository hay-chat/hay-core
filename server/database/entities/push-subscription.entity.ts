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
import { Organization } from "../../entities/organization.entity";

/**
 * A browser's Web Push subscription for one dashboard user, scoped to the
 * organization that was active when the device opted in. One row per device
 * (the push endpoint is unique). Rows are deleted when the push service
 * answers 404/410 (subscription expired or revoked by the user).
 */
@Entity("push_subscriptions")
@Index("idx_push_subscriptions_user", ["user_id"])
@Index("idx_push_subscriptions_organization", ["organization_id"])
export class PushSubscription {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  user_id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

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

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;
}
