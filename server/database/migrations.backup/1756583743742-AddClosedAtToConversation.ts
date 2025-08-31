import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClosedAtToConversation1756583743742 implements MigrationInterface {
    name = 'AddClosedAtToConversation1756583743742'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" ADD "closed_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "closed_at"`);
    }

}
