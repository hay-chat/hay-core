import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D13-13: `customer_merge_dismissals`, pairs of customers a person marked as
 * "not the same person", so the suggested-merge list stops showing them. The
 * pair is stored ordered (customer_a_id < customer_b_id) and is deleted with
 * either customer.
 */
export class AddCustomerMergeDismissals1785782000000 implements MigrationInterface {
  name = "AddCustomerMergeDismissals1785782000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_merge_dismissals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "customer_a_id" uuid NOT NULL,
        "customer_b_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_customer_merge_dismissals" PRIMARY KEY ("id"),
        CONSTRAINT "uq_customer_merge_dismissals_pair" UNIQUE ("customer_a_id", "customer_b_id"),
        CONSTRAINT "chk_customer_merge_dismissals_order" CHECK ("customer_a_id" < "customer_b_id"),
        CONSTRAINT "fk_customer_merge_dismissals_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_customer_merge_dismissals_customer_a" FOREIGN KEY ("customer_a_id")
          REFERENCES "customers"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_customer_merge_dismissals_customer_b" FOREIGN KEY ("customer_b_id")
          REFERENCES "customers"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_customer_merge_dismissals_organization" ON "customer_merge_dismissals" ("organization_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_merge_dismissals"`);
  }
}
