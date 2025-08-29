import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

export class CreateConversationsAndMessagesTables1756470442267 implements MigrationInterface {
    name = 'CreateConversationsAndMessagesTables1756470442267'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create conversations table
        await queryRunner.createTable(
            new Table({
                name: "conversations",
                columns: [
                    {
                        name: "id",
                        type: "uuid",
                        isPrimary: true,
                        generationStrategy: "uuid",
                        default: "uuid_generate_v4()"
                    },
                    {
                        name: "title",
                        type: "varchar",
                        length: "255"
                    },
                    {
                        name: "agent_id",
                        type: "uuid"
                    },
                    {
                        name: "organization_id",
                        type: "uuid"
                    },
                    {
                        name: "created_at",
                        type: "timestamp",
                        default: "now()"
                    },
                    {
                        name: "updated_at",
                        type: "timestamp",
                        default: "now()"
                    }
                ]
            }),
            true
        );

        // Create messages table
        await queryRunner.createTable(
            new Table({
                name: "messages",
                columns: [
                    {
                        name: "id",
                        type: "uuid",
                        isPrimary: true,
                        generationStrategy: "uuid",
                        default: "uuid_generate_v4()"
                    },
                    {
                        name: "conversation_id",
                        type: "uuid"
                    },
                    {
                        name: "content",
                        type: "text"
                    },
                    {
                        name: "type",
                        type: "enum",
                        enum: ["AIMessage", "ChatMessage", "FunctionMessage", "HumanMessage", "ToolMessage", "SystemMessage"]
                    },
                    {
                        name: "usage_metadata",
                        type: "jsonb",
                        isNullable: true
                    },
                    {
                        name: "created_at",
                        type: "timestamp",
                        default: "now()"
                    },
                    {
                        name: "updated_at",
                        type: "timestamp",
                        default: "now()"
                    }
                ]
            }),
            true
        );

        // Create foreign keys for conversations
        await queryRunner.createForeignKey(
            "conversations",
            new TableForeignKey({
                columnNames: ["agent_id"],
                referencedColumnNames: ["id"],
                referencedTableName: "agents",
                onDelete: "CASCADE"
            })
        );

        await queryRunner.createForeignKey(
            "conversations",
            new TableForeignKey({
                columnNames: ["organization_id"],
                referencedColumnNames: ["id"],
                referencedTableName: "organizations",
                onDelete: "CASCADE"
            })
        );

        // Create foreign key for messages
        await queryRunner.createForeignKey(
            "messages",
            new TableForeignKey({
                columnNames: ["conversation_id"],
                referencedColumnNames: ["id"],
                referencedTableName: "conversations",
                onDelete: "CASCADE"
            })
        );

        // Create indexes
        await queryRunner.query(`CREATE INDEX "IDX_conversations_agent_id" ON "conversations" ("agent_id")`);

        await queryRunner.query(`CREATE INDEX "IDX_conversations_organization_id" ON "conversations" ("organization_id")`);

        await queryRunner.query(`CREATE INDEX "IDX_messages_conversation_id" ON "messages" ("conversation_id")`);

        await queryRunner.query(`CREATE INDEX "IDX_messages_type" ON "messages" ("type")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes
        await queryRunner.query(`DROP INDEX "IDX_messages_type"`);
        await queryRunner.query(`DROP INDEX "IDX_messages_conversation_id"`);
        await queryRunner.query(`DROP INDEX "IDX_conversations_organization_id"`);
        await queryRunner.query(`DROP INDEX "IDX_conversations_agent_id"`);

        // Drop messages table (this will also drop foreign keys)
        await queryRunner.dropTable("messages");

        // Drop conversations table (this will also drop foreign keys)
        await queryRunner.dropTable("conversations");
    }
}