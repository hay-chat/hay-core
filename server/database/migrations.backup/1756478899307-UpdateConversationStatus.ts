import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateConversationStatus1756478899307 implements MigrationInterface {
  name = "UpdateConversationStatus1756478899307";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, add the new values to the enum
    await queryRunner.query(
      `ALTER TYPE "public"."conversations_status_enum" RENAME TO "conversations_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."conversations_status_enum" AS ENUM('open', 'processing', 'pending-human', 'resolved', 'closed')`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "status" TYPE "public"."conversations_status_enum" USING "status"::"text"::"public"."conversations_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'open'`);
    await queryRunner.query(`DROP TYPE "public"."conversations_status_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert back to the old enum values
    // Note: This will fail if there are rows with 'processing' or 'closed' status
    await queryRunner.query(
      `CREATE TYPE "public"."conversations_status_enum_old" AS ENUM('open', 'pending-human', 'resolved')`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "status" TYPE "public"."conversations_status_enum_old" USING "status"::"text"::"public"."conversations_status_enum_old"`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'open'`);
    await queryRunner.query(`DROP TYPE "public"."conversations_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."conversations_status_enum_old" RENAME TO "conversations_status_enum"`,
    );
  }
}
