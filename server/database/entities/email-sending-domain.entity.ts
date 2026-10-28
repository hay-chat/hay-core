import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";

/** One DNS record the merchant must add, as Resend reports it. */
export interface EmailDomainRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  priority?: number;
  status?: string;
}

/**
 * An organization's optional custom sending domain (D13-9). Unique per
 * organization and per domain; see the migration.
 */
@Entity("email_sending_domains")
export class EmailSendingDomain {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  /** Lowercase domain name, e.g. "acme.com". */
  @Column({ type: "varchar", length: 253 })
  domain!: string;

  @Column({ type: "varchar", length: 64 })
  resend_domain_id!: string;

  /** Resend status: not_started, pending, verified, failed, temporary_failure. */
  @Column({ type: "varchar", length: 32, default: "not_started" })
  status!: string;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  records!: EmailDomainRecord[];

  @Column({ type: "timestamptz", nullable: true })
  verified_at!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
