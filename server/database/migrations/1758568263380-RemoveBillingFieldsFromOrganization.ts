import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveBillingFieldsFromOrganization1758568263380 implements MigrationInterface {
    name = 'RemoveBillingFieldsFromOrganization1758568263380'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "plan"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "trial_ends_at"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "billing_email"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" ADD "billing_email" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "trial_ends_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "plan" character varying(50) NOT NULL DEFAULT 'free'`);
    }

}
