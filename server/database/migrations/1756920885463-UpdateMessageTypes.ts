import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateMessageTypes1756920885463 implements MigrationInterface {
    name = 'UpdateMessageTypes1756920885463'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add a temporary column with the new enum type
        await queryRunner.query(`CREATE TYPE "public"."messages_type_enum_new" AS ENUM('Customer', 'System', 'HumanAgent', 'BotAgent', 'ToolCall', 'ToolResponse')`);
        await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN "type_new" "public"."messages_type_enum_new"`);
        
        // Map old values to new values
        await queryRunner.query(`UPDATE "messages" SET "type_new" = 'Customer' WHERE "type" = 'HumanMessage'`);
        await queryRunner.query(`UPDATE "messages" SET "type_new" = 'System' WHERE "type" = 'SystemMessage'`);
        await queryRunner.query(`UPDATE "messages" SET "type_new" = 'BotAgent' WHERE "type" = 'AIMessage'`);
        await queryRunner.query(`UPDATE "messages" SET "type_new" = 'ToolCall' WHERE "type" = 'FunctionMessage'`);
        await queryRunner.query(`UPDATE "messages" SET "type_new" = 'ToolResponse' WHERE "type" = 'ToolMessage'`);
        await queryRunner.query(`UPDATE "messages" SET "type_new" = 'Customer' WHERE "type" = 'ChatMessage'`);
        
        // Drop old column and rename new column
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "type"`);
        await queryRunner.query(`ALTER TABLE "messages" RENAME COLUMN "type_new" TO "type"`);
        
        // Clean up old enum type and rename new one
        await queryRunner.query(`DROP TYPE "public"."messages_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."messages_type_enum_new" RENAME TO "messages_type_enum"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Add a temporary column with the old enum type
        await queryRunner.query(`CREATE TYPE "public"."messages_type_enum_old" AS ENUM('AIMessage', 'ChatMessage', 'FunctionMessage', 'HumanMessage', 'ToolMessage', 'SystemMessage')`);
        await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN "type_old" "public"."messages_type_enum_old"`);
        
        // Map new values back to old values
        await queryRunner.query(`UPDATE "messages" SET "type_old" = 'HumanMessage' WHERE "type" = 'Customer'`);
        await queryRunner.query(`UPDATE "messages" SET "type_old" = 'SystemMessage' WHERE "type" = 'System'`);
        await queryRunner.query(`UPDATE "messages" SET "type_old" = 'AIMessage' WHERE "type" = 'BotAgent'`);
        await queryRunner.query(`UPDATE "messages" SET "type_old" = 'AIMessage' WHERE "type" = 'HumanAgent'`);
        await queryRunner.query(`UPDATE "messages" SET "type_old" = 'FunctionMessage' WHERE "type" = 'ToolCall'`);
        await queryRunner.query(`UPDATE "messages" SET "type_old" = 'ToolMessage' WHERE "type" = 'ToolResponse'`);
        
        // Drop new column and rename old column
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "type"`);
        await queryRunner.query(`ALTER TABLE "messages" RENAME COLUMN "type_old" TO "type"`);
        
        // Clean up new enum type and rename old one
        await queryRunner.query(`DROP TYPE "public"."messages_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."messages_type_enum_old" RENAME TO "messages_type_enum"`);
    }

}
