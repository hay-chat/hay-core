import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDPoPAuthFields1758211469585 implements MigrationInterface {
    name = 'AddDPoPAuthFields1758211469585'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."messages_direction_enum" AS ENUM('in', 'out')`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "direction" "public"."messages_direction_enum" NOT NULL DEFAULT 'in'`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "provider_message_id" character varying(255)`);
        await queryRunner.query(`CREATE TYPE "public"."conversations_channel_enum" AS ENUM('web', 'whatsapp', 'instagram', 'telegram', 'sms', 'email')`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "channel" "public"."conversations_channel_enum" NOT NULL DEFAULT 'web'`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "public_jwk" jsonb`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "last_message_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "last_message_at"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "public_jwk"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "channel"`);
        await queryRunner.query(`DROP TYPE "public"."conversations_channel_enum"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "provider_message_id"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "direction"`);
        await queryRunner.query(`DROP TYPE "public"."messages_direction_enum"`);
    }

}
