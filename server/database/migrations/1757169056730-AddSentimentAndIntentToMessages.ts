import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSentimentAndIntentToMessages1757169056730 implements MigrationInterface {
    name = 'AddSentimentAndIntentToMessages1757169056730'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."messages_sentiment_enum" AS ENUM('positive', 'neutral', 'negative')`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "sentiment" "public"."messages_sentiment_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."messages_intent_enum" AS ENUM('greet', 'question', 'request', 'handoff', 'close_satisfied', 'close_unsatisfied', 'other', 'unknown')`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "intent" "public"."messages_intent_enum"`);
        await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "type" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "type" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "intent"`);
        await queryRunner.query(`DROP TYPE "public"."messages_intent_enum"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "sentiment"`);
        await queryRunner.query(`DROP TYPE "public"."messages_sentiment_enum"`);
    }

}
