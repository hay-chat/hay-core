import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAttachmentsAndStatusToMessages1757355309998 implements MigrationInterface {
    name = 'AddAttachmentsAndStatusToMessages1757355309998'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ADD "attachments" jsonb`);
        await queryRunner.query(`CREATE TYPE "public"."messages_status_enum" AS ENUM('pending', 'approved', 'rejected', 'edited')`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "status" "public"."messages_status_enum" NOT NULL DEFAULT 'approved'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "status"`);
        await queryRunner.query(`DROP TYPE "public"."messages_status_enum"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "attachments"`);
    }

}
