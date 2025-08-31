import { MigrationInterface, QueryRunner } from "typeorm";

export class AddToneAvoidTriggerToAgents1756643101496 implements MigrationInterface {
    name = 'AddToneAvoidTriggerToAgents1756643101496'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "agents" ADD "tone" text`);
        await queryRunner.query(`ALTER TABLE "agents" ADD "avoid" text`);
        await queryRunner.query(`ALTER TABLE "agents" ADD "trigger" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN "trigger"`);
        await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN "avoid"`);
        await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN "tone"`);
    }

}
