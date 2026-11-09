import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "@server/entities/base.entity";
import { User } from "@server/entities/user.entity";

const numberTransformer = {
  to: (value: number) => value,
  from: (value: string | number) => Number(value),
};

/** A security key or passkey registered as a second factor. */
@Entity("user_webauthn_credentials")
@Index("uq_user_webauthn_credentials_credential_id", ["credentialId"], { unique: true })
@Index("idx_user_webauthn_credentials_user_id", ["userId"])
export class UserWebauthnCredential extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn()
  user?: User;

  /** Base64url credential id, as the browser reports it. */
  @Column({ type: "text" })
  credentialId!: string;

  /** COSE-encoded public key. */
  @Column({ type: "bytea" })
  publicKey!: Buffer;

  /** Highest signature counter seen. Authenticators that do not count stay at 0. */
  @Column({ type: "bigint", default: 0, transformer: numberTransformer })
  signCount!: number;

  @Column({ type: "jsonb", default: () => "'[]'" })
  transports!: string[];

  @Column({ type: "varchar", length: 100 })
  name!: string;

  /** "singleDevice" or "multiDevice" (a passkey that can sync). */
  @Column({ type: "varchar", length: 32 })
  deviceType!: string;

  @Column({ type: "boolean", default: false })
  backedUp!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  lastUsedAt?: Date | null;
}
