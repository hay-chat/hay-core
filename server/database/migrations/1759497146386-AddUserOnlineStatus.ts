import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserOnlineStatus1759497146386 implements MigrationInterface {
    name = 'AddUserOnlineStatus1759497146386'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "last_seen_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ADD "status" character varying(20) NOT NULL DEFAULT 'available'`);
        await queryRunner.query(`CREATE INDEX "idx_users_last_seen_at" ON "users" ("last_seen_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_users_last_seen_at"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_seen_at"`);
    }

}
