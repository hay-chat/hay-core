import { MigrationInterface, QueryRunner } from "typeorm";

export class FixColumnNaming1756600000000 implements MigrationInterface {
  name = "FixColumnNaming1756600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if columns exist with wrong names and rename them

    // Fix users table columns if they exist with wrong names
    const userColumns = await queryRunner.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users' 
            AND table_schema = 'public'
        `);

    const userColumnNames = userColumns.map((col: { column_name: string }) => col.column_name);

    // Check and rename columns if needed
    if (
      userColumnNames.includes("organizationid") &&
      !userColumnNames.includes("organization_id")
    ) {
      await queryRunner.query(
        `ALTER TABLE "users" RENAME COLUMN "organizationid" TO "organization_id"`,
      );
    }
    if (userColumnNames.includes("firstname") && !userColumnNames.includes("first_name")) {
      await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "firstname" TO "first_name"`);
    }
    if (userColumnNames.includes("lastname") && !userColumnNames.includes("last_name")) {
      await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "lastname" TO "last_name"`);
    }
    if (userColumnNames.includes("isactive") && !userColumnNames.includes("is_active")) {
      await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "isactive" TO "is_active"`);
    }
    if (userColumnNames.includes("lastloginat") && !userColumnNames.includes("last_login_at")) {
      await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "lastloginat" TO "last_login_at"`);
    }
    if (userColumnNames.includes("createdat") && !userColumnNames.includes("created_at")) {
      await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "createdat" TO "created_at"`);
    }
    if (userColumnNames.includes("updatedat") && !userColumnNames.includes("updated_at")) {
      await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "updatedat" TO "updated_at"`);
    }
    if (userColumnNames.includes("createdby") && !userColumnNames.includes("created_by")) {
      await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "createdby" TO "created_by"`);
    }
    if (userColumnNames.includes("updatedby") && !userColumnNames.includes("updated_by")) {
      await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "updatedby" TO "updated_by"`);
    }

    // Fix api_keys table columns
    const apiKeyColumns = await queryRunner.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'api_keys' 
            AND table_schema = 'public'
        `);

    const apiKeyColumnNames = apiKeyColumns.map((col: { column_name: string }) => col.column_name);

    if (apiKeyColumnNames.includes("userid") && !apiKeyColumnNames.includes("user_id")) {
      await queryRunner.query(`ALTER TABLE "api_keys" RENAME COLUMN "userid" TO "user_id"`);
    }
    if (
      apiKeyColumnNames.includes("organizationid") &&
      !apiKeyColumnNames.includes("organization_id")
    ) {
      await queryRunner.query(
        `ALTER TABLE "api_keys" RENAME COLUMN "organizationid" TO "organization_id"`,
      );
    }
    if (apiKeyColumnNames.includes("keyhash") && !apiKeyColumnNames.includes("key_hash")) {
      await queryRunner.query(`ALTER TABLE "api_keys" RENAME COLUMN "keyhash" TO "key_hash"`);
    }
    if (apiKeyColumnNames.includes("lastusedat") && !apiKeyColumnNames.includes("last_used_at")) {
      await queryRunner.query(
        `ALTER TABLE "api_keys" RENAME COLUMN "lastusedat" TO "last_used_at"`,
      );
    }
    if (apiKeyColumnNames.includes("expiresat") && !apiKeyColumnNames.includes("expires_at")) {
      await queryRunner.query(`ALTER TABLE "api_keys" RENAME COLUMN "expiresat" TO "expires_at"`);
    }
    if (apiKeyColumnNames.includes("isactive") && !apiKeyColumnNames.includes("is_active")) {
      await queryRunner.query(`ALTER TABLE "api_keys" RENAME COLUMN "isactive" TO "is_active"`);
    }
    if (apiKeyColumnNames.includes("createdat") && !apiKeyColumnNames.includes("created_at")) {
      await queryRunner.query(`ALTER TABLE "api_keys" RENAME COLUMN "createdat" TO "created_at"`);
    }
    if (apiKeyColumnNames.includes("updatedat") && !apiKeyColumnNames.includes("updated_at")) {
      await queryRunner.query(`ALTER TABLE "api_keys" RENAME COLUMN "updatedat" TO "updated_at"`);
    }

    // Fix organizations table columns
    const orgColumns = await queryRunner.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'organizations' 
            AND table_schema = 'public'
        `);

    const orgColumnNames = orgColumns.map((col: { column_name: string }) => col.column_name);

    if (orgColumnNames.includes("isactive") && !orgColumnNames.includes("is_active")) {
      await queryRunner.query(
        `ALTER TABLE "organizations" RENAME COLUMN "isactive" TO "is_active"`,
      );
    }
    if (orgColumnNames.includes("createdat") && !orgColumnNames.includes("created_at")) {
      await queryRunner.query(
        `ALTER TABLE "organizations" RENAME COLUMN "createdat" TO "created_at"`,
      );
    }
    if (orgColumnNames.includes("updatedat") && !orgColumnNames.includes("updated_at")) {
      await queryRunner.query(
        `ALTER TABLE "organizations" RENAME COLUMN "updatedat" TO "updated_at"`,
      );
    }

    // Fix documents table columns
    const docColumns = await queryRunner.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'documents' 
            AND table_schema = 'public'
        `);

    const docColumnNames = docColumns.map((col: { column_name: string }) => col.column_name);

    if (docColumnNames.includes("organizationid") && !docColumnNames.includes("organization_id")) {
      await queryRunner.query(
        `ALTER TABLE "documents" RENAME COLUMN "organizationid" TO "organization_id"`,
      );
    }
    if (docColumnNames.includes("createdat") && !docColumnNames.includes("created_at")) {
      await queryRunner.query(`ALTER TABLE "documents" RENAME COLUMN "createdat" TO "created_at"`);
    }
    if (docColumnNames.includes("updatedat") && !docColumnNames.includes("updated_at")) {
      await queryRunner.query(`ALTER TABLE "documents" RENAME COLUMN "updatedat" TO "updated_at"`);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Revert column names back (if needed)
    // This is intentionally left empty as we don't want to revert to incorrect names
  }
}
