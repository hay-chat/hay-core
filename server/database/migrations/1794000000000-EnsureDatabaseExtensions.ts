import { MigrationInterface, QueryRunner } from "typeorm";

/** The application role may not be allowed to create extensions, so the owner does it here. */
export class EnsureDatabaseExtensions1794000000000 implements MigrationInterface {
  name = "EnsureDatabaseExtensions1794000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  }

  public async down(): Promise<void> {
    // Extensions stay: every embedding column depends on them.
  }
}
