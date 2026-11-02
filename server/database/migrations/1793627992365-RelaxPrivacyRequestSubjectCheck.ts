import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A privacy request may outlive its subject: the customer row is deleted by
 * the erasure it asked for (customer_id is ON DELETE SET NULL), and a request
 * for an email with no account has no user. The check now only keeps the two
 * subject kinds apart.
 */
export class RelaxPrivacyRequestSubjectCheck1793627992365 implements MigrationInterface {
  name = "RelaxPrivacyRequestSubjectCheck1793627992365";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "privacy_requests" DROP CONSTRAINT IF EXISTS "chk_privacy_requests_subject_integrity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "privacy_requests" ADD CONSTRAINT "chk_privacy_requests_subject_integrity" CHECK (
        (subject_type = 'user' AND customer_id IS NULL) OR
        (subject_type = 'customer' AND user_id IS NULL)
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "privacy_requests" DROP CONSTRAINT IF EXISTS "chk_privacy_requests_subject_integrity"`,
    );
    // NOT VALID: rows written since up() may have no subject id.
    await queryRunner.query(
      `ALTER TABLE "privacy_requests" ADD CONSTRAINT "chk_privacy_requests_subject_integrity" CHECK (
        (subject_type = 'user' AND user_id IS NOT NULL AND customer_id IS NULL) OR
        (subject_type = 'customer' AND customer_id IS NOT NULL AND user_id IS NULL)
      ) NOT VALID`,
    );
  }
}
