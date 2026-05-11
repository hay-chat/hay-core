import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFormMessageType1782000000005 implements MigrationInterface {
  name = "AddFormMessageType1782000000005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.query(`
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'Form'
      AND enumtypid = 'messages_type_enum'::regtype
    `);

    if (!exists || exists.length === 0) {
      await queryRunner.query(`ALTER TYPE messages_type_enum ADD VALUE 'Form'`);
    }
  }

  public async down(): Promise<void> {
    // Postgres cannot drop enum values without recreating the type; leave 'Form' in place.
  }
}
