import { Column, Entity, Index, JoinColumn, OneToOne } from "typeorm";
import { BaseEntity } from "@server/entities/base.entity";
import { User } from "@server/entities/user.entity";

/**
 * A user's second-factor state. One row per user. The authenticator app is active
 * once `confirmedAt` is set; security keys live in `user_webauthn_credentials`.
 * The recovery codes and the step-up window apply to every factor.
 */
@Entity("user_mfa")
@Index("uq_user_mfa_user_id", ["userId"], { unique: true })
export class UserMfa extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @OneToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn()
  user?: User;

  /** Base32 TOTP secret, encrypted with encryptValue. Null for people using security keys only. */
  @Column({ type: "text", nullable: true })
  secret?: string | null;

  /** When the authenticator app was confirmed; null while pending or not in use. */
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
