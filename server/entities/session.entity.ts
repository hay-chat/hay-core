import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./base.entity";
import { User } from "./user.entity";

@Entity("sessions")
@Index("idx_sessions_user_id", ["userId"])
@Index("idx_sessions_refresh_token_hash", ["refreshTokenHash"])
@Index("idx_sessions_expires_at", ["expiresAt"])
export class Session extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn()
  user?: User;

  @Column({ type: "varchar", length: 255 })
  refreshTokenHash!: string;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz" })
  lastActivity!: Date;

  @Column({ type: "varchar", length: 255, nullable: true })
  ipAddress?: string;

  @Column({ type: "text", nullable: true })
  userAgent?: string;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  toJSON(): Omit<Session, "refreshTokenHash"> {
    const { refreshTokenHash: _refreshTokenHash, ...sessionWithoutToken } = this;
    return sessionWithoutToken;
  }
}
