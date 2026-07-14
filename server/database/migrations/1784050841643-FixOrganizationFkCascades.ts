import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fixes FK delete rules that were missing from several entities, which made
 * organization deletion fail with FK violations (first reported on documents).
 *
 * Drops every existing FK on each (table, column) pair by lookup — api_keys
 * had accumulated two constraints on organization_id — then re-adds a single
 * constraint using the TypeORM-generated name so future schema diffs stay clean.
 */
export class FixOrganizationFkCascades1784050841643 implements MigrationInterface {
  name = "FixOrganizationFkCascades1784050841643";

  private readonly foreignKeys = [
    // [table, column, constraintName, onDelete]
    ["documents", "organization_id", "FK_69427761f37533ae7767601a64b", "CASCADE"],
    ["api_keys", "organization_id", "FK_a283bdef18876e525aefaec042f", "CASCADE"],
    ["jobs", "organization_id", "FK_3d9a2080fffe3e2c3b72fd56df2", "CASCADE"],
    ["plugin_instances", "organization_id", "FK_3351804d975a13769f702c5b518", "CASCADE"],
    ["privacy_requests", "organization_id", "FK_e638a389d49f2f3516c12a551f4", "CASCADE"],
    ["users", "organization_id", "FK_21a659804ed7bf61eb91688dea7", "SET NULL"],
  ] as const;

  private async dropExistingForeignKeys(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<void> {
    const constraints: { conname: string }[] = await queryRunner.query(
      `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
       WHERE con.contype = 'f' AND rel.relname = $1 AND att.attname = $2`,
      [table, column],
    );
    for (const { conname } of constraints) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${conname}"`);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column, constraintName, onDelete] of this.foreignKeys) {
      await this.dropExistingForeignKeys(queryRunner, table, column);
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${constraintName}"
         FOREIGN KEY ("${column}") REFERENCES "organizations"("id")
         ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column, constraintName] of this.foreignKeys) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${constraintName}"`);
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${constraintName}"
         FOREIGN KEY ("${column}") REFERENCES "organizations"("id")
         ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }
}
