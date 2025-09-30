import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPluginPathToRegistry1759251569861 implements MigrationInterface {
    name = 'AddPluginPathToRegistry1759251569861'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add column as nullable first
        await queryRunner.query(`ALTER TABLE "plugin_registry" ADD "plugin_path" character varying(255)`);
        
        // Update existing rows to use plugin_id without 'hay-plugin-' prefix as default
        await queryRunner.query(`
            UPDATE "plugin_registry" 
            SET "plugin_path" = 
                CASE 
                    WHEN "plugin_id" LIKE 'hay-plugin-%' 
                    THEN REPLACE("plugin_id", 'hay-plugin-', '')
                    ELSE "plugin_id"
                END
        `);
        
        // Make column NOT NULL after populating
        await queryRunner.query(`ALTER TABLE "plugin_registry" ALTER COLUMN "plugin_path" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "plugin_registry" DROP COLUMN "plugin_path"`);
    }

}
