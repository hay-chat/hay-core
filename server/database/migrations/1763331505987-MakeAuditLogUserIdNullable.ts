import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeAuditLogUserIdNullable1763331505987 implements MigrationInterface {
    name = 'MakeAuditLogUserIdNullable1763331505987'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Make user_id nullable in audit_logs table to support anonymization
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "user_id" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverse the change
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "user_id" SET NOT NULL`);
    }
}
