import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPluginInstanceLifecycleFields1758046520159 implements MigrationInterface {
    name = 'AddPluginInstanceLifecycleFields1758046520159'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "plugin_registry" ADD "max_concurrent_instances" integer NOT NULL DEFAULT '10'`);
        await queryRunner.query(`ALTER TABLE "plugin_instances" ADD "last_activity_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "plugin_instances" ADD "priority" integer NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "plugin_instances" DROP COLUMN "priority"`);
        await queryRunner.query(`ALTER TABLE "plugin_instances" DROP COLUMN "last_activity_at"`);
        await queryRunner.query(`ALTER TABLE "plugin_registry" DROP COLUMN "max_concurrent_instances"`);
    }

}
