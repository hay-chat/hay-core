import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class CreatePlaybooksTable1756456967043 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "playbook_status_enum" AS ENUM('draft', 'active', 'archived')`);
        
        await queryRunner.createTable(
            new Table({
                name: "playbooks",
                columns: [
                    {
                        name: "id",
                        type: "uuid",
                        isPrimary: true,
                        generationStrategy: "uuid",
                        default: "uuid_generate_v4()"
                    },
                    {
                        name: "name",
                        type: "varchar",
                        length: "255"
                    },
                    {
                        name: "description",
                        type: "text",
                        isNullable: true
                    },
                    {
                        name: "instructions",
                        type: "text",
                        isNullable: true
                    },
                    {
                        name: "status",
                        type: "playbook_status_enum",
                        default: "'draft'"
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
                ],
                foreignKeys: [
                    {
                        columnNames: ["organization_id"],
                        referencedTableName: "organizations",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE"
                    }
                ]
            })
        );

        await queryRunner.createTable(
            new Table({
                name: "playbook_agents",
                columns: [
                    {
                        name: "playbook_id",
                        type: "uuid"
                    },
                    {
                        name: "agent_id",
                        type: "uuid"
                    }
                ],
                foreignKeys: [
                    {
                        columnNames: ["playbook_id"],
                        referencedTableName: "playbooks",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE"
                    },
                    {
                        columnNames: ["agent_id"],
                        referencedTableName: "agents",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE"
                    }
                ],
                indices: [
                    {
                        columnNames: ["playbook_id", "agent_id"],
                        isUnique: true
                    }
                ]
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("playbook_agents");
        await queryRunner.dropTable("playbooks");
        await queryRunner.query(`DROP TYPE "playbook_status_enum"`);
    }

}
