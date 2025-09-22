import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveStripeFieldsFromOrganization1758563821788 implements MigrationInterface {
    name = 'RemoveStripeFieldsFromOrganization1758563821788'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "stripe_customer_id"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "stripe_subscription_id"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "stripe_plan_id"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "stripe_subscription_status"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" ADD "stripe_subscription_status" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "stripe_plan_id" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "stripe_subscription_id" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "stripe_customer_id" character varying(255)`);
    }

}
