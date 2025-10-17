import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDetectedLanguageToMessages1760708144310 implements MigrationInterface {
    name = 'AddDetectedLanguageToMessages1760708144310'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ADD "detected_language" character varying(10)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "detected_language"`);
    }

}
