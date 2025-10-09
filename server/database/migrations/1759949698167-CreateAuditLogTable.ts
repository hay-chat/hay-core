import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuditLogTable1759949698167 implements MigrationInterface {
    name = 'CreateAuditLogTable1759949698167'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "fk_conversations_assigned_user"`);
        await queryRunner.query(`DROP INDEX "public"."idx_conversations_assigned_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_conversations_status_assigned"`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD CONSTRAINT "FK_913b133c5fd52744e5a51963154" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "FK_913b133c5fd52744e5a51963154"`);
        await queryRunner.query(`CREATE INDEX "idx_conversations_status_assigned" ON "conversations" ("assigned_user_id", "status") `);
        await queryRunner.query(`CREATE INDEX "idx_conversations_assigned_user_id" ON "conversations" ("assigned_user_id") `);
        await queryRunner.query(`ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations_assigned_user" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}
