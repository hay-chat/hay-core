import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./base.entity";
import { User } from "./user.entity";

export type SessionRevokedReason = "logout" | "reuse_detected" | "password_changed";

/**
 * One login on one device: a refresh-token family.
 *
 * The refresh token is derived from (id, generation) and is never stored.
 * Each refresh bumps `generation` (rotation) and pushes `expiresAt` to
 * now + the idle timeout (sliding session). See auth-session.service.ts.
 */
@Entity("sessions")
@Index("idx_sessions_user_id", ["userId"])
@Index("idx_sessions_expires_at", ["expiresAt"])
@Index("idx_sessions_legacy_token_hash", ["legacyTokenHash"], {
  unique: true,
  where: '"legacy_token_hash" IS NOT NULL',
})
export class Session extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn()
  user?: User;

  /** Bumped on every refresh; only the token of the current generation rotates. */
  @Column({ type: "integer", default: 0 })
  generation!: number;

  /** users.token_version when the session started; a password change bumps it. */
  @Column({ type: "integer", default: 0 })
  tokenVersion!: number;

  @Column({ type: "timestamptz", nullable: true })
  rotatedAt?: Date | null;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz" })
  lastActivity!: Date;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt?: Date | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  revokedReason?: SessionRevokedReason | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  ipAddress?: string | null;

  @Column({ type: "text", nullable: true })
  userAgent?: string | null;

  /**
   * sha256 of the pre-rotation JWT refresh token this session replaced, so
   * that token is accepted only once. TODO: drop with refreshLegacy.
   */
  @Column({ type: "varchar", length: 64, nullable: true })
  legacyTokenHash?: string | null;
}
