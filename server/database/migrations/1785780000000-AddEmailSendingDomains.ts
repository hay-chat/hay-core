import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D13-9: `email_sending_domains`, an organization's optional custom sending
 * domain for the email channel. Registered with Resend (`resend_domain_id`);
 * `records` holds the DNS records the merchant must add, `status` mirrors
 * Resend's verification status. One domain per organization, and a domain can
 * belong to only one organization. Plugins may send From an address on the
 * domain only once `status` is 'verified'.
 */
export class AddEmailSendingDomains1785780000000 implements MigrationInterface {
  name = "AddEmailSendingDomains1785780000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "email_sending_domains" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "domain" varchar(253) NOT NULL,
        "resend_domain_id" varchar(64) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'not_started',
        "records" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_email_sending_domains" PRIMARY KEY ("id"),
        CONSTRAINT "uq_email_sending_domains_organization" UNIQUE ("organization_id"),
        CONSTRAINT "uq_email_sending_domains_domain" UNIQUE ("domain"),
        CONSTRAINT "fk_email_sending_domains_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "email_sending_domains"`);
  }
}
