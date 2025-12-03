import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrganizationAboutField1764702400000 implements MigrationInterface {
    name = 'AddOrganizationAboutField1764702400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" ADD "about" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "about"`);
    }
}
