import { Column, Entity, Index, JoinColumn, OneToOne } from "typeorm";
import { BaseEntity } from "@server/entities/base.entity";
import { User } from "@server/entities/user.entity";

/** A user's authenticator enrolment. One row per user; active once `confirmedAt` is set. */
@Entity("user_mfa")
@Index("uq_user_mfa_user_id", ["userId"], { unique: true })
export class UserMfa extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @OneToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn()
  user?: User;

  /** Base32 TOTP secret, encrypted with encryptValue. */
  @Column({ type: "text" })
  secret!: string;

  @Column({ type: "timestamptz", nullable: true })
  confirmedAt?: Date | null;

  /** The latest time step accepted; that step and earlier ones can't be used again. */
  @Column({ type: "int", nullable: true })
  lastUsedStep?: number | null;

  /** SHA-256 hashes of the unused recovery codes. */
  @Column({ type: "jsonb", default: () => "'[]'" })
  recoveryCodes!: string[];

  /** The session that last passed a step-up check, and until when that holds. */
  @Column({ type: "uuid", nullable: true })
  stepUpSessionId?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  stepUpExpiresAt?: Date | null;
}
